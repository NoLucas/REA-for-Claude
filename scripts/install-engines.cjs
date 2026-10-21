#!/usr/bin/env node
/*
 * install-engines.cjs — cross-platform engine installer for REA (Windows, macOS, Linux).
 *
 *   node scripts/install-engines.cjs                 # install what is missing
 *   node scripts/install-engines.cjs --dry-run       # show the plan for this OS, download nothing
 *   node scripts/install-engines.cjs --only ghidra,jadx
 *   node scripts/install-engines.cjs --dir D:\tools\rea-engines --write-config
 *
 * What it installs into ~/.rea-engines (or --dir / REA_PLUGIN_ENGINES_DIR / config.engines_dir):
 *   - JDK 21 (Eclipse Temurin, SHA-256 verified)  -> <dir>/jdk-21        only if no JDK 21+ is usable
 *   - Ghidra 12.1.4 (SHA-256 verified)            -> <dir>/ghidra_12.1.4_PUBLIC
 *   - jadx-headless-mcp 0.7.1                     -> <dir>/jadx-headless-mcp-0.7.1-all.jar
 *   - Linux only: apt tools via install-engines.sh (radare2, binwalk, tshark, apktool, ...)
 *
 * The right JDK/Ghidra build is picked from process.platform + process.arch, so the same
 * command works on Windows x64, macOS Apple Silicon / Intel, and Linux x64 / arm64.
 * On macOS the quarantine attribute is cleared and launch scripts are made executable.
 *
 * Idempotent: present pieces are skipped. Writes <dir>/install.lock while running,
 * <dir>/install.done and <dir>/engines.json when finished. The launcher (launch-rea.cjs)
 * auto-discovers <dir>, so no configuration is needed afterwards.
 *
 * Optional engines (not part of "all" unless config.optional_engines is true):
 *   - apktool 3.0.3 (jar + `apktool` wrapper in <dir>/bin)       --only apktool
 *   - radare2 6.2.4: Windows zip (x64/arm64) into <dir>/radare2;  --only radare2
 *     macOS via Homebrew when present; Linux via apt
 *
 * Downloads resume (curl -C - / HTTP Range) and are looked up first in an archive
 * directory for offline or mirrored installs: REA_PLUGIN_ARCHIVE_DIR, config.archive_dir,
 * or <dir>/archives — drop the release files there (same file names) and nothing is fetched.
 *
 * Flags:
 *   --background      log-friendly mode used by the launcher / SessionStart hook
 *   --only <list>     comma list from: jdk, ghidra, jadx, apt, apktool, radare2   (default: all)
 *   --no-jdk          never download a JDK (same as REA_PLUGIN_SKIP_JDK=1)
 *   --dir <path>      target directory
 *   --force           re-download even if present
 *   --upgrade         move an existing install to the pinned versions (rea-engines-lib.cjs
 *                     VERSIONS); older Ghidra / jadx copies are removed after the new ones verify
 *   --wsl             Windows: install the Linux engines inside WSL (runs install-engines.sh in
 *                     the default distro; with --wsl-install, runs `wsl --install -d Ubuntu`
 *                     first when no distro exists — needs admin and a reboot)
 *   --write-config    write the resulting paths into ~/.rea-plugin.json
 *   --set-env         Windows: also set GHIDRA_INSTALL_DIR / REA_JADX_MCP_JAR / JAVA_HOME as user env vars
 *   --dry-run         print the plan and exit 0
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const lib = require('./rea-engines-lib.cjs');

const { VERSIONS, GHIDRA_DIR_NAME } = lib;

// ---------------------------------------------------------------------------- args
const args = process.argv.slice(2);
const flags = { background: false, only: null, noJdk: false, dir: null, force: false, upgrade: false, wsl: false, wslInstall: false, writeConfig: false, setEnv: false, dryRun: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--background') flags.background = true;
  else if (a === '--only') flags.only = args[++i] || '';
  else if (a.startsWith('--only=')) flags.only = a.slice(7);
  else if (a === '--no-jdk') flags.noJdk = true;
  else if (a === '--dir') flags.dir = args[++i];
  else if (a.startsWith('--dir=')) flags.dir = a.slice(6);
  else if (a === '--force') flags.force = true;
  else if (a === '--upgrade') flags.upgrade = true;
  else if (a === '--wsl') flags.wsl = true;
  else if (a === '--wsl-install') { flags.wsl = true; flags.wslInstall = true; }
  else if (a === '--write-config') flags.writeConfig = true;
  else if (a === '--set-env') flags.setEnv = true;
  else if (a === '--dry-run') flags.dryRun = true;
  else if (a === '-h' || a === '--help') {
    const src = fs.readFileSync(__filename, 'utf8').split('\n');
    console.log(src.slice(2, src.findIndex((l) => l.startsWith(' */'))).map((l) => l.replace(/^ \*( |$)/, '')).join('\n'));
    process.exit(0);
  }
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`[install-engines ${stamp()}] ${m}`);
const fail = (m) => { console.error(`[install-engines ${stamp()}] ERROR: ${m}`); };

const config = lib.readConfig();
const plat = lib.platformInfo();
const DIR = flags.dir ? path.resolve(flags.dir) : lib.enginesDir(config);
if (flags.only) process.env.REA_PLUGIN_ENGINES = flags.only;
const { selection, wants } = lib.engineSelection(config);
const skipJdk = flags.noJdk || process.env.REA_PLUGIN_SKIP_JDK === '1' || config.jdk === false || (flags.only && !wants('jdk') && !wants('all'));
const paths = lib.expectedPaths(DIR);
const has = (cmd) => !spawnSync(cmd, ['--version'], { stdio: 'ignore', windowsHide: true }).error;

// ---------------------------------------------------------------------------- helpers
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: opts.quiet ? 'ignore' : ['ignore', 'inherit', 'inherit'], windowsHide: true, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.slice(0, 2).join(' ')} exited ${r.status}`);
  return r;
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

function httpsGet(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'rea-for-claude-installer' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpsGet(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      if (dest) {
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      } else {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body));
      }
    }).on('error', reject);
  });
}

function httpsResume(url, dest, redirects = 0) {
  // Node fallback with HTTP Range so an interrupted .part continues instead of restarting.
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('too many redirects'));
    const have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const headers = { 'User-Agent': 'rea-for-claude-installer' };
    if (have > 0) headers.Range = `bytes=${have}-`;
    https.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(httpsResume(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode === 416) { res.resume(); return resolve(); } // already complete
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const out = fs.createWriteStream(dest, { flags: res.statusCode === 206 ? 'a' : 'w' });
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

/** Look for a pre-downloaded copy (offline / mirror mode). */
function findArchive(fileName, sha256) {
  for (const d of lib.archiveDirs(config, process.env, DIR)) {
    const f = path.join(d, fileName);
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) continue;
    if (sha256 && sha256File(f).toLowerCase() !== sha256.toLowerCase()) { log(`archive ${f} has the wrong SHA-256; ignoring it`); continue; }
    return f;
  }
  return null;
}

/**
 * Download with curl when available (proxy + retry + resume aware), else Node https with
 * Range. A matching file in an archive dir is copied instead of downloaded. The .part file
 * is kept on failure so the next run resumes it.
 */
async function download(url, dest, label, sha256) {
  const tmp = `${dest}.part`;
  if (sha256 && fs.existsSync(dest)) {
    // A previous run already fetched it (e.g. extraction failed afterwards): reuse if intact.
    if (sha256File(dest).toLowerCase() === sha256.toLowerCase()) { log(`reusing verified download ${path.basename(dest)}`); return dest; }
    fs.rmSync(dest, { force: true });
  }
  const archived = findArchive(path.basename(url), sha256);
  if (archived) {
    log(`using archived ${path.basename(archived)} from ${path.dirname(archived)} (no download)`);
    fs.copyFileSync(archived, dest);
    return dest;
  }
  const partial = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  log(`${partial ? `resuming (${Math.round(partial / 1e6)} MB already)` : 'downloading'} ${label} ...`);
  log(`  ${url}`);
  if (has('curl')) {
    const r = spawnSync('curl', ['-fL', '-C', '-', '--retry', '3', '--retry-delay', '5', '-#', '-o', tmp, url], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    if (r.status !== 0) {
      log(`curl exited ${r.status}; retrying with Node https (resume)`);
      await httpsResume(url, tmp);
    }
  } else {
    await httpsResume(url, tmp);
  }
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) throw new Error(`download produced no data: ${url}`);
  if (sha256 && sha256File(tmp).toLowerCase() !== sha256.toLowerCase()) {
    // A resumed .part can be corrupt if the server ignored Range; start over once.
    log('checksum mismatch on the assembled file; discarding partial data and downloading once more');
    fs.rmSync(tmp, { force: true });
    if (has('curl')) spawnSync('curl', ['-fL', '--retry', '3', '--retry-delay', '5', '-#', '-o', tmp, url], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    else await httpsResume(url, tmp);
  }
  fs.renameSync(tmp, dest);
  return dest;
}

async function fetchJson(url) {
  if (has('curl')) {
    const r = spawnSync('curl', ['-fsSL', '--retry', '3', url], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) return JSON.parse(r.stdout);
  }
  return JSON.parse(await httpsGet(url));
}

function verifySha256(file, expected, label) {
  const got = sha256File(file);
  if (got.toLowerCase() !== expected.toLowerCase()) {
    fs.rmSync(file, { force: true });
    throw new Error(`SHA-256 mismatch for ${label}: expected ${expected}, got ${got}`);
  }
  log(`sha256 verified (${label})`);
}

/** Extract .zip / .tar.gz into `dest` with whatever the OS provides. */
async function extract(archive, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const isZip = /\.zip$/i.test(archive);
  const attempts = [];
  if (!isZip) {
    attempts.push(['tar', ['-xzf', archive, '-C', dest]]);
    // No gzip binary on PATH? Inflate with Node's zlib, then untar the plain archive.
    attempts.push([gunzipWithNode, [archive, dest]]);
  } else if (process.platform === 'win32') {
    attempts.push(['tar.exe', ['-xf', archive, '-C', dest]]); // bsdtar, Windows 10 1803+
    attempts.push(['powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]]);
  } else if (process.platform === 'darwin') {
    attempts.push(['ditto', ['-x', '-k', archive, dest]]); // keeps unix permissions
    attempts.push(['unzip', ['-q', archive, '-d', dest]]);
  } else {
    attempts.push(['unzip', ['-q', archive, '-d', dest]]);
    attempts.push(['bsdtar', ['-xf', archive, '-C', dest]]);
    attempts.push(['python3', ['-m', 'zipfile', '-e', archive, dest]]);
  }
  let lastErr;
  for (const [cmd, a] of attempts) {
    try {
      if (typeof cmd === 'function') await cmd(...a);
      else run(cmd, a, { quiet: true });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`could not extract ${path.basename(archive)}: ${lastErr ? lastErr.message : 'no extractor found'}`);
}

async function gunzipWithNode(archive, dest) {
  const zlib = require('node:zlib');
  const { pipeline } = require('node:stream/promises');
  const tar = archive.replace(/\.(tar\.gz|tgz)$/i, '') + '.tar';
  await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(tar));
  try {
    run('tar', ['-xf', tar, '-C', dest], { quiet: true });
  } finally {
    fs.rmSync(tar, { force: true });
  }
}

/** The single top-level directory an archive unpacked into `stage`. */
function soleChild(stage) {
  const kids = fs.readdirSync(stage).filter((k) => !k.startsWith('.') && !k.startsWith('__MACOSX'));
  if (kids.length !== 1) throw new Error(`unexpected archive layout in ${stage}: ${kids.join(', ')}`);
  return path.join(stage, kids[0]);
}

function chmodTree(root, pred) {
  if (process.platform === 'win32') return;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(p)) { try { fs.chmodSync(p, 0o755); } catch { /* ignore */ } }
    }
  };
  if (fs.existsSync(root)) walk(root);
}

function macUnquarantine(p) {
  if (process.platform !== 'darwin') return;
  spawnSync('xattr', ['-dr', 'com.apple.quarantine', p], { stdio: 'ignore' });
}

function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
}

// ---------------------------------------------------------------------------- steps
async function stepJdk(plan) {
  const jdk = lib.findJdk(config);
  if (jdk.ok && !flags.force) {
    log(`java: ${jdk.line} [${jdk.source}${jdk.javaHome ? `: ${jdk.javaHome}` : ''}]`);
    return jdk.javaHome;
  }
  if (skipJdk) {
    log(`JDK ${VERSIONS.jdkMajor}+ with javac not found and JDK download disabled; Ghidra needs one (${plat.platform === 'win32' ? 'winget install EclipseAdoptium.Temurin.21.JDK' : plat.platform === 'darwin' ? 'brew install --cask temurin@21' : 'apt-get install openjdk-21-jdk-headless'})`);
    return undefined;
  }
  const api = `https://api.adoptium.net/v3/assets/latest/${VERSIONS.jdkMajor}/hotspot?os=${plat.adoptiumOs}&architecture=${plat.adoptiumArch}&image_type=jdk&vendor=eclipse`;
  if (plan) { log(`plan: JDK ${VERSIONS.jdkMajor} (Temurin ${plat.adoptiumOs}/${plat.adoptiumArch}) -> ${paths.JDK_DIR}`); log(`      via ${api}`); return paths.JDK_DIR; }
  log(`JDK ${VERSIONS.jdkMajor}+ not found (${jdk.line || 'no java on PATH'}); fetching Eclipse Temurin for ${plat.adoptiumOs}/${plat.adoptiumArch}`);
  const assets = await fetchJson(api);
  const pkg = assets && assets[0] && assets[0].binary && assets[0].binary.package;
  if (!pkg || !pkg.link) throw new Error('Adoptium API returned no JDK package for this platform');
  const archive = path.join(DIR, `.${pkg.name}`);
  await download(pkg.link, archive, `${pkg.name} (~${Math.round(pkg.size / 1e6)} MB)`, pkg.checksum);
  if (pkg.checksum) verifySha256(archive, pkg.checksum, pkg.name);
  const stage = `${paths.JDK_DIR}.tmp`;
  log('extracting JDK');
  await extract(archive, stage);
  replaceDir(soleChild(stage), paths.JDK_DIR);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  macUnquarantine(paths.JDK_DIR);
  const home = lib.resolveJavaHome(paths.JDK_DIR);
  if (!home) throw new Error(`JDK extracted but no java binary found under ${paths.JDK_DIR}`);
  const info = lib.javaInfo(lib.javaBin(home));
  log(`jdk installed: ${info.line || home} -> ${home}`);
  return home;
}

async function stepGhidra(plan) {
  if (!wants('ghidra')) { log('ghidra not selected; skipping'); return undefined; }
  const marker = path.join(paths.GHIDRA_INSTALL_DIR, 'support', process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless');
  if (fs.existsSync(marker) && !flags.force) { log(`ghidra ${VERSIONS.ghidra} already installed at ${paths.GHIDRA_INSTALL_DIR}`); return paths.GHIDRA_INSTALL_DIR; }
  if (!fs.existsSync(marker) && !flags.upgrade && !flags.force) {
    // Another Ghidra release present and the pinned one absent: only --upgrade replaces it.
    const other = lib.discover(DIR).GHIDRA_INSTALL_DIR;
    if (other && !plan) { log(`found ${path.basename(other)}; pinned ${VERSIONS.ghidra} not installed — run with --upgrade to move to it (the old copy is removed after the new one verifies)`); return other; }
  }
  if (plan) { log(`plan: Ghidra ${VERSIONS.ghidra} (~570 MB, sha256 ${VERSIONS.ghidraSha256.slice(0, 12)}…) -> ${paths.GHIDRA_INSTALL_DIR}`); return paths.GHIDRA_INSTALL_DIR; }
  const archive = path.join(DIR, `.${VERSIONS.ghidraZip}`);
  await download(VERSIONS.ghidraUrl, archive, `Ghidra ${VERSIONS.ghidra} (~570 MB)`, VERSIONS.ghidraSha256);
  verifySha256(archive, VERSIONS.ghidraSha256, VERSIONS.ghidraZip);
  const stage = `${paths.GHIDRA_INSTALL_DIR}.tmp`;
  log('extracting Ghidra');
  await extract(archive, stage);
  replaceDir(path.join(stage, GHIDRA_DIR_NAME), paths.GHIDRA_INSTALL_DIR);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  // Make sure launch scripts and native decompiler binaries are executable (zip tools differ).
  chmodTree(path.join(paths.GHIDRA_INSTALL_DIR, 'support'), (p) => !/\.(bat|txt|properties|jar|xml|html|py|java)$/i.test(p));
  chmodTree(path.join(paths.GHIDRA_INSTALL_DIR, 'Ghidra', 'Features', 'Decompiler', 'os'), () => true);
  chmodTree(path.join(paths.GHIDRA_INSTALL_DIR, 'Ghidra', 'Debug'), (p) => /\/os\/[^/]+\/[^/]+$/.test(p.replace(/\\/g, '/')));
  try { fs.chmodSync(path.join(paths.GHIDRA_INSTALL_DIR, 'ghidraRun'), 0o755); } catch { /* win */ }
  macUnquarantine(paths.GHIDRA_INSTALL_DIR);
  log(`ghidra installed at ${paths.GHIDRA_INSTALL_DIR}`);
  if (flags.upgrade) {
    for (const e of fs.readdirSync(DIR)) {
      if (/^ghidra_\d+\.\d+(?:\.\d+)?_PUBLIC$/.test(e) && e !== GHIDRA_DIR_NAME) { fs.rmSync(path.join(DIR, e), { recursive: true, force: true }); log(`removed old ${e}`); }
    }
  }
  return paths.GHIDRA_INSTALL_DIR;
}

async function stepJadx(plan) {
  if (!wants('jadx') || process.env.REA_PLUGIN_SKIP_JADX === '1') { log('jadx not selected; skipping'); return undefined; }
  if (fs.existsSync(paths.REA_JADX_MCP_JAR) && fs.statSync(paths.REA_JADX_MCP_JAR).size > 0 && !flags.force) { log('jadx-headless-mcp already present'); return paths.REA_JADX_MCP_JAR; }
  if (plan) { log(`plan: jadx-headless-mcp 0.7.1 (~40 MB) -> ${paths.REA_JADX_MCP_JAR}`); return paths.REA_JADX_MCP_JAR; }
  await download(VERSIONS.jadxUrl, paths.REA_JADX_MCP_JAR, `jadx-headless-mcp ${VERSIONS.jadx} (~40 MB)`);
  log('jadx-headless-mcp installed');
  if (flags.upgrade) {
    for (const e of fs.readdirSync(DIR)) {
      if (/^jadx-headless-mcp-.*-all\.jar$/.test(e) && e !== VERSIONS.jadxJar) { fs.rmSync(path.join(DIR, e), { force: true }); log(`removed old ${e}`); }
    }
  }
  return paths.REA_JADX_MCP_JAR;
}

// ---- optional engines ---------------------------------------------------------
function writeWrapper(name, unixBody, winBody) {
  fs.mkdirSync(paths.BIN_DIR, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(paths.BIN_DIR, `${name}.cmd`), winBody.replace(/\r?\n/g, '\r\n'));
  } else {
    const f = path.join(paths.BIN_DIR, name);
    fs.writeFileSync(f, unixBody);
    fs.chmodSync(f, 0o755);
  }
}

async function stepApktool(plan) {
  if (!wants('apktool')) return undefined;
  if (fs.existsSync(paths.REA_APKTOOL_JAR) && fs.statSync(paths.REA_APKTOOL_JAR).size > 0 && !flags.force) { log(`apktool ${VERSIONS.apktool} already present`); return paths.REA_APKTOOL_JAR; }
  if (plan) { log(`plan: apktool ${VERSIONS.apktool} (~15 MB) -> ${paths.REA_APKTOOL_JAR} + ${path.join(paths.BIN_DIR, 'apktool')} wrapper`); return paths.REA_APKTOOL_JAR; }
  await download(VERSIONS.apktoolUrl, paths.REA_APKTOOL_JAR, `apktool ${VERSIONS.apktool} (~15 MB)`, VERSIONS.apktoolSha256);
  verifySha256(paths.REA_APKTOOL_JAR, VERSIONS.apktoolSha256, VERSIONS.apktoolJar);
  // Wrapper so `apktool` works on PATH (the launcher puts <dir>/bin first).
  const jar = paths.REA_APKTOOL_JAR;
  writeWrapper('apktool',
    `#!/usr/bin/env bash\nexec "\${JAVA_HOME:+$JAVA_HOME/bin/}java" -jar "${jar}" "$@"\n`,
    `@echo off\r\nif defined JAVA_HOME (set "_J=%JAVA_HOME%\\bin\\java.exe") else (set "_J=java")\r\n"%_J%" -jar "${jar}" %*\r\n`);
  if (flags.upgrade) for (const e of fs.readdirSync(DIR)) if (/^apktool_.*\.jar$/.test(e) && e !== VERSIONS.apktoolJar) { fs.rmSync(path.join(DIR, e), { force: true }); log(`removed old ${e}`); }
  log('apktool installed');
  return jar;
}

async function stepRadare2(plan) {
  if (!wants('radare2')) return undefined;
  if (process.platform === 'win32') {
    const pick = VERSIONS.radare2Win[process.arch];
    if (!pick) { log(`radare2: no Windows build for ${process.arch}; skipping`); return undefined; }
    const exe = path.join(paths.RADARE2_DIR, 'bin', 'radare2.exe');
    if (fs.existsSync(exe) && !flags.force) { log(`radare2 ${VERSIONS.radare2} already installed`); return paths.RADARE2_DIR; }
    if (plan) { log(`plan: radare2 ${VERSIONS.radare2} (${pick.zip}, ~13 MB) -> ${paths.RADARE2_DIR}`); return paths.RADARE2_DIR; }
    const archive = path.join(DIR, `.${pick.zip}`);
    await download(VERSIONS.radare2UrlBase + pick.zip, archive, `radare2 ${VERSIONS.radare2} (~13 MB)`, pick.sha256);
    verifySha256(archive, pick.sha256, pick.zip);
    const stage = `${paths.RADARE2_DIR}.tmp`;
    await extract(archive, stage);
    replaceDir(path.join(stage, pick.dir), paths.RADARE2_DIR);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
    log(`radare2 installed at ${paths.RADARE2_DIR}`);
    return paths.RADARE2_DIR;
  }
  if (has('radare2') || has('r2')) { log('radare2 already on PATH'); return 'PATH'; }
  if (process.platform === 'darwin') {
    if (!has('brew')) { log('radare2: Homebrew not found; install with `brew install radare2` or the .pkg from https://github.com/radareorg/radare2/releases'); return undefined; }
    if (plan) { log('plan: radare2 via `brew install radare2`'); return 'brew'; }
    const r = spawnSync('brew', ['install', 'radare2'], { stdio: 'inherit' });
    if (r.status === 0) { log('radare2 installed via Homebrew'); return 'brew'; }
    log('brew install radare2 failed (non-fatal)');
    return undefined;
  }
  log('radare2: on Linux it comes with the apt step (install-engines.sh)');
  return undefined;
}

// ---- Windows: WSL provisioning -----------------------------------------------------
function stepWsl(plan) {
  if (!flags.wsl) return;
  if (process.platform !== 'win32') { log('--wsl is Windows-only'); return; }
  const list = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', windowsHide: true });
  const distros = (list.stdout || '').split(/\r?\n/).map((s) => s.replace(/\0/g, '').trim()).filter(Boolean);
  const distro = lib.clean(config.wsl_distro) && distros.includes(config.wsl_distro) ? config.wsl_distro : distros[0];
  if (!distro) {
    if (flags.wslInstall) {
      if (plan) { log('plan: wsl --install -d Ubuntu (needs administrator; Windows will ask for a reboot), then re-run --wsl'); return; }
      log('no WSL distro found; running `wsl --install -d Ubuntu` (administrator prompt; reboot required, then re-run `install-engines.cjs --wsl`)');
      spawnSync('wsl.exe', ['--install', '-d', 'Ubuntu'], { stdio: 'inherit', windowsHide: false });
      return;
    }
    log('no WSL distro found. Run `wsl --install -d Ubuntu` (administrator, reboot), or re-run with --wsl-install to let this script do it; then `install-engines.cjs --wsl`');
    return;
  }
  const sh = path.join(__dirname, 'install-engines.sh');
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(sh);
  const wslSh = m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : sh;
  if (plan) { log(`plan: wsl -d ${distro} -- bash ${wslSh}  (Ghidra, jadx, radare2, binwalk, tshark, apktool inside WSL; then set "use_wsl": true)`); return; }
  log(`installing Linux engines inside WSL (${distro}) via install-engines.sh ...`);
  const r = spawnSync('wsl.exe', ['-d', distro, '--', 'bash', wslSh], { stdio: 'inherit', windowsHide: true });
  if (r.status === 0) log(`WSL engines ready. Put "use_wsl": true (and "wsl_distro": "${distro}") in ~/.rea-plugin.json to run REA inside WSL.`);
  else log('WSL install failed (non-fatal); open the distro and run install-engines.sh by hand');
}

function stepApt(plan) {
  if (process.platform !== 'linux' || !wants('apt') || process.env.REA_PLUGIN_SKIP_APT === '1') return;
  if (!has('apt-get')) { log('apt-get not available; skipping Linux extras'); return; }
  if (plan) { log('plan: apt tools (binutils gdb radare2 binwalk tshark apktool) via install-engines.sh'); return; }
  const sh = path.join(__dirname, 'install-engines.sh');
  log('installing Linux apt tools via install-engines.sh --only apt');
  const r = spawnSync('bash', [sh, '--only', 'apt'], { stdio: 'inherit', env: { ...process.env, REA_PLUGIN_ENGINES_DIR: DIR } });
  if (r.status !== 0) log('apt tools step failed (non-fatal)');
}

function writeConfig(result) {
  const cfgPath = lib.clean(process.env.REA_PLUGIN_CONFIG) || path.join(os.homedir(), '.rea-plugin.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {}; } catch { cfg = {}; }
  if (result.ghidra) cfg.ghidra_install_dir = result.ghidra;
  if (result.jadx) cfg.jadx_mcp_jar = result.jadx;
  if (result.javaHome) cfg.java_home = result.javaHome;
  cfg.engines_dir = DIR;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  log(`config written: ${cfgPath}`);
}

function setUserEnvWindows(result) {
  if (process.platform !== 'win32') { log('--set-env is Windows-only; the launcher auto-discovers the engines directory on this OS'); return; }
  const pairs = [['GHIDRA_INSTALL_DIR', result.ghidra], ['REA_JADX_MCP_JAR', result.jadx], ['JAVA_HOME', result.javaHome]].filter(([, v]) => v);
  const ps = pairs.map(([k, v]) => `[Environment]::SetEnvironmentVariable('${k}', '${String(v).replace(/'/g, "''")}', 'User')`).join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  log(r.status === 0 ? 'user environment variables written (restart terminals / Claude Desktop to pick them up)' : 'could not write user environment variables');
}

// ---------------------------------------------------------------------------- main
async function main() {
  log(`platform ${plat.label}; engines dir ${DIR}; selection ${selection}${skipJdk ? '; jdk download disabled' : ''}${flags.upgrade ? '; upgrade to pinned versions' : ''}`);
  const archives = lib.archiveDirs(config, process.env, DIR).filter((d) => fs.existsSync(d));
  if (archives.length) log(`archive dirs (offline/mirror): ${archives.join(', ')}`);
  if (!plat.supported) {
    fail(`unsupported platform ${plat.label}: install Ghidra ${VERSIONS.ghidra} and jadx-headless-mcp by hand and set the paths in ~/.rea-plugin.json`);
    process.exit(2);
  }
  const plan = flags.dryRun;
  if (!plan) fs.mkdirSync(DIR, { recursive: true });
  const status = lib.installStatus(DIR);
  if (!plan) {
    // Exclusive lock: the SessionStart hook and the launcher may both start an installer
    // within the same second; only the first one proceeds.
    if (!status.running) fs.rmSync(status.lock, { force: true }); // stale (>30 min) or absent
    try {
      fs.writeFileSync(status.lock, String(process.pid), { flag: 'wx' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      log(`another install is running (${status.lock}); exiting. Follow it with: tail -f ${status.log}`);
      process.exit(0);
    }
  }
  const release = () => { try { fs.rmSync(status.lock, { force: true }); } catch { /* ignore */ } };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130); });

  const result = {};
  let failures = 0;
  const step = async (name, fn) => {
    try { return await fn(plan); } catch (e) { failures++; fail(`${name}: ${e.message}`); return undefined; }
  };
  result.javaHome = await step('jdk', stepJdk);
  result.ghidra = await step('ghidra', stepGhidra);
  result.jadx = await step('jadx', stepJadx);
  result.apktool = await step('apktool', stepApktool);
  result.radare2 = await step('radare2', stepRadare2);
  await step('apt', async (p) => stepApt(p));
  await step('wsl', async (p) => stepWsl(p));

  if (plan) { log('dry run complete; nothing was downloaded'); return; }

  // Record what is actually in DIR now (not just this run), so partial runs never erase entries.
  const present = lib.discover(DIR);
  const jdkNow = lib.findJdk(config);
  result.ghidra = result.ghidra || present.GHIDRA_INSTALL_DIR;
  result.jadx = result.jadx || present.REA_JADX_MCP_JAR;
  result.javaHome = result.javaHome || present.JAVA_HOME || jdkNow.javaHome;
  const manifest = {
    installedAt: new Date().toISOString(),
    platform: plat.platform,
    arch: plat.arch,
    enginesDir: DIR,
    ghidra: result.ghidra || null,
    jadx: result.jadx || null,
    javaHome: result.javaHome || null,
    javaSource: jdkNow.ok ? jdkNow.source : null,
    apktool: present.REA_APKTOOL_JAR || null,
    radare2: present.RADARE2_BIN || (result.radare2 === 'brew' || result.radare2 === 'PATH' ? result.radare2 : null),
    versions: { ghidra: VERSIONS.ghidra, jadx: VERSIONS.jadx, jdk: jdkNow.ok ? String(jdkNow.major) : null, apktool: present.REA_APKTOOL_JAR ? VERSIONS.apktool : null, radare2: present.RADARE2_BIN ? VERSIONS.radare2 : null },
  };
  fs.writeFileSync(path.join(DIR, 'engines.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (flags.writeConfig) writeConfig(result);
  if (flags.setEnv) setUserEnvWindows(result);

  if (failures === 0) {
    fs.writeFileSync(status.doneFile, new Date().toISOString());
    log(`done. GHIDRA_INSTALL_DIR=${result.ghidra || '-'}  REA_JADX_MCP_JAR=${result.jadx || '-'}  JAVA_HOME=${result.javaHome || '(system)'}`);
    log(flags.background
      ? 'REA picks these up on the next open_binary call; no restart needed.'
      : 'The plugin launcher auto-discovers this directory. Run /rea:doctor to confirm.');
  } else {
    fs.rmSync(status.doneFile, { force: true });
    fail(`${failures} step(s) failed. Re-run this installer after fixing the cause (network allow-list for github.com, release-assets.githubusercontent.com and api.adoptium.net; disk space; proxy).`);
    process.exitCode = 1;
  }
}

main().catch((e) => { fail(e.stack || e.message); process.exit(1); });
