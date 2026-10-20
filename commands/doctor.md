---
description: Check whether the REA MCP server and its analysis engines (Ghidra, IDA, jadx, Kuna) are ready in this environment
allowed-tools: Bash(npx -y rea-agents@*), Bash(node *launch-rea.cjs*), Bash(tail *), Bash(cat *)
---

Report REA's readiness in plain language.

1. If `~/.rea-engines/install.lock` exists, an engine install is running: show
   `tail -5 ~/.rea-engines/install.log` and say how to wait.
2. Execute `npx -y rea-agents@6.7.0 doctor --format json` with the same engine variables
   the plugin resolves. The simplest way: if `~/.rea-plugin.json` or `~/.rea-engines`
   exists, export `GHIDRA_INSTALL_DIR` / `REA_JADX_MCP_JAR` from there first
   (`ls ~/.rea-engines`), then run doctor.
3. Summarise from the JSON: whether the MCP server itself is healthy, and for each
   provider in `providerInspections` (ghidra, ida, jadx, kuna) whether it is configured
   and available; for unavailable ones quote the one-line `remediation`.
4. If a provider the user needs is missing: on Linux offer `/rea:install-engines`; on
   Windows/macOS tell the user which path to put in `~/.rea-plugin.json`, then restart
   the client (or reconnect the `rea` server from `/mcp`).
5. Never run `rea setup` here; the plugin already registers the server.
