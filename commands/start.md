---
description: Get started with REA — find out where REA can run in this session (here, on your linked computer, or nowhere yet), fix what is missing, and show what to ask next
allowed-tools: Bash(node *ensure-engines.cjs* --status*), Bash(node *setup-mcp.cjs* --check*), Bash(git rev-parse *)
---

The user has just installed the REA plugin, or does not know how to use it. Get them to a
working REA in as few steps as possible and answer in **their language**. Keep the reply short:
a one-line verdict, what (if anything) they must do, then three example requests.

1. **Find REA's tools.** Look at your tool list (search for `open_binary` if tools are deferred):
   - `mcp__rea__*` → REA runs **in this session** (local Claude Code, Claude Desktop, or a cloud
     session whose repository registers it).
   - `mcp__remote-devices__plugin_rea_rea__*` → this claude.ai session is **linked to the user's
     computer** and REA runs there through Claude Desktop. Nothing needs setting up. Target paths
     are paths on that computer, and the computer must stay on with the desktop app running.
   - If both exist, prefer `mcp__rea__*` for files in this session's workspace and the linked
     tools for files on the user's computer.
2. **If REA's tools exist**, call `binary_session` on that server (no arguments) and report in
   one or two lines whether the `ghidra` analysis provider is `available` and whether jadx is
   configured. If Ghidra or jadx is unavailable:
   - REA in this session: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-engines.cjs" --status`;
     an install in progress finishes by itself in 1–5 minutes, otherwise offer `/rea:install-engines`.
   - REA on the linked computer: engines install themselves there when the desktop app starts the
     server; if they stay missing, tell the user to run `/rea:install-engines` in Claude Desktop or
     Claude Code on that computer. Do not report this container's engine status as theirs.
   IDA, Hopper and Kuna are optional commercial / caller-supplied engines — never present them as
   problems.
3. **If neither exists**, REA's server is not loaded here (claude.ai cloud sessions skip plugin
   MCP servers). Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-mcp.cjs" --check` and
   `git rev-parse --show-toplevel`, then give the user the options that fit, easiest first:
   1. **Link this session to their computer** — install the REA plugin in the Claude desktop
      app on that computer and open the session linked to it. Best for regular use: engines
      install once on their computer and stay.
   2. **Use a repository** — if this is a git repository, offer to run `/rea:setup-mcp` and
      commit the three files; every new session on that repository then has REA. If it is not a
      git repository, say plainly that files written here vanish with the container, so this
      option needs a repository attached to the session.
   3. **Start a session on `github.com/NoLucas/REA-for-Claude`** — it already ships the files.
   4. **Always-on, computer off** — the Docker appliance in `remote/` added as a claude.ai custom
      connector (mention only if they ask for something that works without their computer).
   MCP servers load only when a session starts, so options 2 and 3 take effect in a new session.
   Do not analyse anything by hand and present it as REA output.
4. **Finish with how to use it** (only when REA is available), in the user's language, e.g.:
   - "What does `<path>/app.apk` do?" — reverse-engineering requests are routed to REA
     automatically.
   - `/rea:analyze <path> [goal]` — guided investigation that saves evidence.
   - `/rea:report` — turn the saved evidence into a shareable HTML/Markdown report.
