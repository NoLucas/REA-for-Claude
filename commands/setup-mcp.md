---
description: Register the REA MCP server at project level (.mcp.json) for hosts that do not load plugin MCP servers — claude.ai cloud sessions — so mcp__rea__* tools exist in the next session
allowed-tools: Bash(node *setup-mcp.cjs*), Bash(node *rea-mcp.cjs* --where), Bash(git status*), Bash(git add *), Bash(git commit *), Bash(cat *)
---

Make the REA MCP server available in this project when the plugin's own server is not loaded.

Background: claude.ai cloud sessions start Claude Code with `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1`.
The plugin's skills, hooks and commands load, but every plugin-declared MCP server is
skipped, so no `mcp__rea__*` tools (`open_binary`, `binary_overview`, …) exist. A project-level
`.mcp.json` is still honoured, and that is what this command writes. Local Claude Code and
Claude Desktop load the plugin's server directly and do not need this.

0. If `mcp__remote-devices__plugin_rea_rea__*` tools exist (search for `open_binary` if
   deferred), the session is linked to the user's computer and REA already runs there through
   Claude Desktop. Say so and stop unless the user explicitly wants a project registration too.
1. Check first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-mcp.cjs" --check` — exit 0 means the
   server is already registered (it names the source); nothing to do.
2. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-mcp.cjs"` (add `--dir <path>` for a
   project other than the current one; `--print` shows what would be written). It writes, merging
   with existing content:
   - `.mcp.json` — `mcpServers.rea` → `node .claude/rea-mcp.cjs`
   - `.claude/rea-mcp.cjs` — a dependency-free bootstrap that finds the installed plugin's
     `launch-rea.cjs` at run time (so engines, config and auto-install behave exactly as in the
     plugin) and falls back to `npx -y rea-agents@6.7.0 mcp` when the plugin is absent
   - `.claude/settings.json` — `enableAllProjectMcpServers: true`, so the server needs no approval
3. Tell the user, in one short paragraph, that MCP servers load only at session start, so this
   takes effect in the **next** session; in a cloud session the three files must be committed
   (and pushed) first, because an uncommitted file does not survive into a new container. Offer to
   commit them (`git add .mcp.json .claude/rea-mcp.cjs .claude/settings.json`). Do not push unless
   asked. If the script printed `WARNING: … is not a git repository`, say that the files cannot
   be kept from here and offer the alternatives: attach a repository to the session and run this
   there, or link the session to a computer whose Claude desktop app has the REA plugin.
4. If the user asks for reverse engineering in *this* session, say that REA's tools are not
   available here yet rather than analysing by hand as if REA had run; `/rea:doctor` shows the
   `mcp:` row.
5. `--remove` undoes the registration (`.claude/settings.json` is left alone).
