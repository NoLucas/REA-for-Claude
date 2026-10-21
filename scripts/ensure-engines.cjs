#!/usr/bin/env node
/*
 * ensure-engines.cjs — SessionStart hook (Windows, macOS, Linux, cloud).
 *
 * Runs in well under a second: looks at ~/.rea-engines, and if Ghidra / jadx / a JDK are
 * missing, starts the matching installer detached in the background and returns. Whatever
 * it prints on stdout becomes context for Claude, so the session knows whether REA is
 * ready, still installing, or needs attention.
 *
 *   hooks/hooks.json (plugin)      -> node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-engines.cjs"
 *   .claude/settings.json (repo)   -> node "$CLAUDE_PROJECT_DIR/scripts/ensure-engines.cjs"
 *
 * Opt out with "auto_engines": false in ~/.rea-plugin.json or REA_PLUGIN_AUTO_ENGINES=0.
 * Flags: --status  only report, never start an install.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lib = require('./rea-engines-lib.cjs');

const statusOnly = process.argv.includes('--status');
const out = [];
const say = (m) => out.push(m);

function startBackgroundInstall(dir, selection) {
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'install.log');
  const fd = fs.openSync(logFile, 'a');
  const env = { ...process.env, REA_PLUGIN_ENGINES_DIR: dir, REA_PLUGIN_ENGINES: selection };
  let command;
  let args;
  if (process.platform === 'linux' && selectionWants(selection, 'apt') && spawn_has('bash') && spawn_has('apt-get')) {
    // Linux with apt: the bash installer also brings radare2/binwalk/tshark/apktool.
    command = 'bash';
    args = [path.join(__dirname, 'install-engines.sh'), '--background'];
  } else {
    command = process.execPath;
    args = [path.join(__dirname, 'install-engines.cjs'), '--background'];
  }
  const child = spawn(command, args, { detached: true, stdio: ['ignore', fd, fd], env, windowsHide: true });
  child.unref();
  fs.closeSync(fd);
  return logFile;
}

function spawn_has(cmd) {
  try {
    return !require('node:child_process').spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error;
  } catch {
    return false;
  }
}
function selectionWants(selection, name) {
  const list = selection.split(',').map((s) => s.trim());
  return list.includes('all') || list.includes(name);
}

function main() {
  const config = lib.readConfig();
  const plat = lib.platformInfo();
  const dir = lib.enginesDir(config);
  const found = lib.discoverAll(config);
  const jdk = lib.findJdk(config);
  const { selection, wants } = lib.engineSelection(config);
  const status = lib.installStatus(dir);
  const auto = lib.autoEnginesEnabled(config);

  const needGhidra = wants('ghidra') && !found.GHIDRA_INSTALL_DIR && !lib.clean(process.env.GHIDRA_INSTALL_DIR) && !lib.clean(config.ghidra_install_dir);
  const needJadx = wants('jadx') && !found.REA_JADX_MCP_JAR && !lib.clean(process.env.REA_JADX_MCP_JAR) && !lib.clean(config.jadx_mcp_jar);
  const needJdk = !jdk.ok && config.jdk !== false && process.env.REA_PLUGIN_SKIP_JDK !== '1';
  const missing = [needJdk && 'JDK 21', needGhidra && 'Ghidra', needJadx && 'jadx'].filter(Boolean);

  // Integrity: a half-extracted Ghidra, a JRE without javac, or a truncated jar looks
  // "present" to the quick check above; validateEngines() finds it and names the exact fix.
  // When the user manages Java themselves (jdk=false / REA_PLUGIN_SKIP_JDK=1) the JDK row is
  // informational: the --status table still shows it, but it does not make the verdict "broken".
  const jdkManaged = config.jdk === false || process.env.REA_PLUGIN_SKIP_JDK === '1';
  const broken = lib.validateEngines(config).filter((v) => !v.ok && v.repair && !(v.engine === 'jdk' && jdkManaged) && !missing.some((m) => m.toLowerCase().startsWith(v.engine === 'jdk' ? 'jdk' : v.engine)));
  if (missing.length === 0 && broken.length === 0) {
    say(`REA: engines ready on ${plat.label} — ${lib.summarize(found, jdk)}.`);
    return;
  }
  if (missing.length === 0 && broken.length) {
    say(`REA: engines present on ${plat.label} but ${broken.map((b) => `${b.engine} is broken (${b.detail})`).join('; ')}. Repair: ${broken.map((b) => b.repair).join(' ; ')}`);
    return;
  }
  if (status.running) {
    say(`REA: engine install in progress on ${plat.label} (missing: ${missing.join(', ')}). Log: ${status.log}. Analysis tools answer provider_unavailable until it finishes; wait for ${status.doneFile}, then call open_binary again.`);
    return;
  }
  if (!plat.supported) {
    say(`REA: ${plat.label} is not supported by the automatic installer. Install Ghidra 12.1.4 + JDK 21 + jadx-headless-mcp by hand and set the paths in ~/.rea-plugin.json.`);
    return;
  }
  if (!auto || statusOnly) {
    say(`REA: engines missing on ${plat.label} (${missing.join(', ')}); automatic install is ${statusOnly ? 'not requested' : 'disabled (auto_engines=false)'}. Run /rea:install-engines to install them into ${dir}.`);
    return;
  }
  try {
    const logFile = startBackgroundInstall(dir, selection);
    const mb = (needGhidra ? 570 : 0) + (needJdk ? 200 : 0) + (needJadx ? 40 : 0);
    say(`REA: installing ${missing.join(' + ')} for ${plat.label} in the background into ${dir} (~${mb} MB, usually 1–5 min). Log: ${logFile}. REA starts now; analysis tools answer provider_unavailable until ${status.doneFile} exists — then call open_binary again (no restart needed). /rea:doctor shows progress.`);
  } catch (err) {
    say(`REA: could not start the engine installer (${err.message}). Run /rea:install-engines manually.`);
  }
}

function mcpLine() {
  const reg = lib.mcpRegistration();
  if (reg.loaded) return statusOnly ? `  ✓ mcp: rea server registered via ${reg.source}` : null;
  const where = reg.cloud ? 'this claude.ai cloud session' : 'this session';
  const linked = lib.LINKED_TOOL_PREFIX;
  const git = lib.insideGitRepo(reg.projectDir);
  const repoStep = git
    ? `run /rea:setup-mcp here, commit the three files it writes, and start new sessions on this repository`
    : `run /rea:setup-mcp in a git repository (${reg.projectDir} is not one, so files written here vanish with this container), commit the three files it writes, and start new sessions on that repository`;
  return [
    `REA: the REA MCP server is NOT loaded in ${where} — the host skips plugin MCP servers (CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS), so no mcp__rea__* tools come from this container. Before telling the user REA is unavailable, check your tool list (tools may be deferred — search for "open_binary"):`,
    `  • ${linked}* tools (e.g. ${linked}open_binary) mean this session is linked to the user's computer and REA is running there in Claude Desktop. Use them: nothing needs setting up, target paths are paths on that computer, and the engine status above describes this container, not that computer (${linked}binary_session reports theirs).`,
    `  • Otherwise REA is unavailable in this session. Tell the user, in their language, the ways to get it: (1) link this session to a computer whose Claude desktop app has the REA plugin installed; (2) ${repoStep}; (3) start a session on github.com/NoLucas/REA-for-Claude, which ships the files. /rea:start walks them through it. Do not analyse by hand and present it as REA output.`,
  ].join('\n');
}

try {
  main();
  const m = mcpLine();
  if (m) say(m);
  if (statusOnly) {
    // Full per-engine table with the exact repair command for anything broken (used by /rea:doctor).
    for (const v of lib.validateEngines(lib.readConfig())) say(`  ${v.ok ? '✓' : '✗'} ${v.engine}: ${v.detail}${v.repair ? `  →  ${v.repair}` : ''}`);
  }
} catch (err) {
  say(`REA: engine check failed: ${err.message}`);
}
process.stdout.write(out.join('\n') + '\n');
