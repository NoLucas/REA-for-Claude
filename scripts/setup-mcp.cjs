#!/usr/bin/env node
/*
 * setup-mcp.cjs — register the REA MCP server at project level (`/rea:setup-mcp`).
 *
 * Needed wherever the host does not load plugin-declared MCP servers — claude.ai cloud
 * sessions set CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1, so the plugin's skills, hooks and
 * commands load but no mcp__rea__* tools exist. A project .mcp.json is still honoured there.
 *
 * Writes into the project directory (merging with whatever is already there):
 *   .mcp.json                 mcpServers.rea -> node .claude/rea-mcp.cjs
 *   .claude/rea-mcp.cjs       copy of scripts/rea-mcp-bootstrap.cjs (finds the installed plugin's
 *                             launcher at run time; falls back to npx rea-agents)
 *   .claude/settings.json     enableAllProjectMcpServers: true (so no approval prompt is needed)
 *
 * Flags:
 *   --dir <path>   project directory (default: $CLAUDE_PROJECT_DIR, then cwd)
 *   --check        report only; write nothing (exit 0 = registered, 1 = not)
 *   --print        print the three files that would be written, write nothing
 *   --force        overwrite an existing .claude/rea-mcp.cjs even if it differs
 *   --remove       undo: drop mcpServers.rea and .claude/rea-mcp.cjs (settings.json untouched)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./rea-engines-lib.cjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

const projectDir = path.resolve(opt('--dir') || lib.clean(process.env.CLAUDE_PROJECT_DIR) || process.cwd());
const mcpFile = path.join(projectDir, '.mcp.json');
const settingsFile = path.join(projectDir, '.claude', 'settings.json');
const bootstrapRel = path.posix.join('.claude', 'rea-mcp.cjs');
const bootstrapFile = path.join(projectDir, '.claude', 'rea-mcp.cjs');
const bootstrapSrc = path.join(__dirname, 'rea-mcp-bootstrap.cjs');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON (${err.message}); fix or remove it and retry`);
  }
}
const pretty = (o) => `${JSON.stringify(o, null, 2)}\n`;

function plan() {
  const mcp = readJson(mcpFile);
  mcp.mcpServers = mcp.mcpServers || {};
  mcp.mcpServers.rea = { command: 'node', args: [bootstrapRel] };
  const settings = readJson(settingsFile);
  settings.enableAllProjectMcpServers = true;
  return { mcp, settings, bootstrap: fs.readFileSync(bootstrapSrc, 'utf8') };
}

function main() {
  const reg = lib.mcpRegistration(projectDir);
  if (flag('--check')) {
    const state = reg.loaded ? `registered via ${reg.source}` : 'NOT registered';
    process.stdout.write(`REA MCP server in ${projectDir}: ${state}${reg.pluginMcpSkipped ? ' (host skips plugin MCP servers)' : ''}\n`);
    process.exit(reg.loaded ? 0 : 1);
  }
  if (flag('--remove')) {
    const mcp = readJson(mcpFile);
    if (mcp.mcpServers) delete mcp.mcpServers.rea;
    if (mcp.mcpServers && Object.keys(mcp.mcpServers).length === 0) delete mcp.mcpServers;
    if (Object.keys(mcp).length) fs.writeFileSync(mcpFile, pretty(mcp)); else fs.rmSync(mcpFile, { force: true });
    fs.rmSync(bootstrapFile, { force: true });
    process.stdout.write(`removed mcpServers.rea from ${mcpFile} and ${bootstrapFile}\n`);
    return;
  }
  const p = plan();
  if (flag('--print')) {
    process.stdout.write(`# ${mcpFile}\n${pretty(p.mcp)}\n# ${settingsFile}\n${pretty(p.settings)}\n# ${bootstrapFile}\n(copy of scripts/rea-mcp-bootstrap.cjs, ${p.bootstrap.length} bytes)\n`);
    return;
  }
  if (fs.existsSync(bootstrapFile) && !flag('--force') && fs.readFileSync(bootstrapFile, 'utf8') !== p.bootstrap) {
    process.stderr.write(`${bootstrapFile} exists and differs from the plugin's copy; re-run with --force to overwrite it.\n`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(bootstrapFile), { recursive: true });
  fs.writeFileSync(bootstrapFile, p.bootstrap);
  fs.writeFileSync(mcpFile, pretty(p.mcp));
  fs.writeFileSync(settingsFile, pretty(p.settings));
  process.stdout.write([
    `REA MCP server registered for ${projectDir}:`,
    `  ${path.relative(projectDir, mcpFile)}            mcpServers.rea -> node ${bootstrapRel}`,
    `  ${bootstrapRel}   locates the installed plugin's launcher (or falls back to npx rea-agents)`,
    `  ${path.relative(projectDir, settingsFile)}  enableAllProjectMcpServers: true`,
    '',
    'MCP servers are loaded when a session starts, so this takes effect in the NEXT session.',
    reg.cloud
      ? 'This is a cloud session: commit these three files and start a new session on this repository — uncommitted files do not survive into a new cloud container.'
      : 'Restart Claude Code in this directory (or reconnect from /mcp) to pick it up.',
  ].join('\n') + '\n');
}

try { main(); } catch (err) { process.stderr.write(`setup-mcp: ${err.message}\n`); process.exit(1); }
