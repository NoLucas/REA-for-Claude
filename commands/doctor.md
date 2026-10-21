---
description: Check whether the REA MCP server and its analysis engines (Ghidra, JDK, jadx, IDA, Kuna) are ready in this environment
allowed-tools: Bash(node *launch-rea.cjs* doctor*), Bash(node *ensure-engines.cjs*), Bash(npx -y rea-agents@*), Bash(tail *), Bash(cat *), Bash(type *)
---

Report REA's readiness in plain language.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-engines.cjs" --status`. It prints a
   one-line verdict (engines ready / install in progress with the log path / engines
   missing / engines present but broken) followed by a per-engine table (ghidra, jdk, jadx,
   and apktool/radare2 when installed or selected). Each broken row ends with the exact
   repair command — e.g. a half-extracted Ghidra → `install-engines.cjs --force --only ghidra`,
   a JRE without `javac` → `--force --only jdk`, an older pinned version → `--upgrade`.
   Offer to run that command; it never starts an install by itself.
2. If an install is in progress, show `tail -5 ~/.rea-engines/install.log` (Windows:
   `type %USERPROFILE%\.rea-engines\install.log`), estimate the remaining time from the
   log (Ghidra is the long download, ~570 MB) and say that REA's analysis tools answer
   `provider_unavailable` until `install.done` appears — then `open_binary` works without
   a restart.
3. Run REA's own doctor with exactly the environment the plugin gives the server:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/launch-rea.cjs" doctor --format json`
   (this resolves `~/.rea-plugin.json`, `~/.rea-engines`, and a bundled JDK in
   `~/.rea-engines/jdk-21` the same way the MCP server does).
4. Summarise from the JSON: for each provider in `providerInspections` (ghidra, ida, jadx,
   kuna) whether it is `configured` and `available`; quote the `ghidra-java` check's
   `detail` so the user sees which JDK is in use; for unavailable providers quote the
   one-line `remediation`. Ignore `skill:identity` and `registration:*` checks — the plugin
   registers the server itself, `rea setup` is not used. IDA, Hopper and Kuna are optional
   commercial / caller-supplied engines; say so instead of treating them as errors.
5. If Ghidra, jadx or the JDK is missing on any OS: offer `/rea:install-engines` (it works on
   Windows, macOS and Linux). If the user prefers their own installs, tell them which keys
   to set in `~/.rea-plugin.json` (`ghidra_install_dir`, `jadx_mcp_jar`, `java_home`), then
   reconnect the `rea` server from `/mcp` or restart the client.
6. Never run `rea setup` here; the plugin already registers the server.
