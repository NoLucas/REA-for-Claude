---
description: Install REA's analysis engines on this Linux host (Ghidra 12.1.4, jadx-headless-mcp, radare2/binwalk/tshark/apktool) into ~/.rea-engines
allowed-tools: Bash(bash *install-engines.sh*), Bash(powershell *install-engines.ps1*), Bash(tail *), Bash(cat *)
---

Install or repair REA's engines on the machine this session runs on.

- **Linux / cloud:** `bash scripts/install-engines.sh` (below).
- **Windows:** `powershell -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-engines.ps1" -WriteConfig`
  (add `-SetEnv` to also write user environment variables). It needs a 64-bit JDK 21+ on
  PATH; if missing, tell the user to run `winget install EclipseAdoptium.Temurin.21.JDK`
  first. Native Windows REA covers PE (x86/x64/ARM) targets with Ghidra; for Linux-only
  tooling suggest `"use_wsl": true` in `~/.rea-plugin.json`.
- **macOS:** install Ghidra 12.1.4 and jadx-headless-mcp 0.7.1 by hand and set the paths in
  `~/.rea-plugin.json`.

1. Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-engines.sh"` (or
   `bash scripts/install-engines.sh` from the repository root) in the foreground; it
   is idempotent and prints what it skips and what it installs. Expect 1–3 minutes on
   first run (570 MB download).
2. If it is already running in the background (`~/.rea-engines/install.lock` exists),
   show `tail -20 ~/.rea-engines/install.log` instead and wait for `done`.
3. When it finishes, tell the user the two resulting paths (`GHIDRA_INSTALL_DIR`,
   `REA_JADX_MCP_JAR`) and that REA picks them up on the next `open_binary` call.
4. If a download fails because of network restrictions, say which URL failed and ask the
   user to allow `github.com` and `release-assets.githubusercontent.com` in their cloud
   environment's network settings, or to supply the files.
