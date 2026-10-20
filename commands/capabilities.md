---
description: List which REA tools are usable right now given the installed analysis engines
allowed-tools: Bash(npx -y rea-agents@*)
---

Execute `npx -y rea-agents@6.7.0 capabilities --format json` (export
`GHIDRA_INSTALL_DIR` and `REA_JADX_MCP_JAR` first when `~/.rea-engines` or
`~/.rea-plugin.json` provides them) and give the user a short, grouped summary of what REA
can do here: native binaries (Ghidra), Android (jadx), managed .NET, JavaScript/Electron,
web/browser capture, firmware, runtime capture. Call out groups that are unavailable
because an engine is not configured or the host OS is unsupported, and point to
`/rea:doctor` or `/rea:install-engines` for remediation.
