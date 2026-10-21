---
description: Install, repair or upgrade REA's analysis engines on this machine (JDK 21 if needed, Ghidra 12.1.4, jadx-headless-mcp, optional apktool/radare2; apt tools on Linux; WSL on Windows) — Windows, macOS and Linux
allowed-tools: Bash(node *install-engines.cjs*), Bash(node *ensure-engines.cjs*), Bash(bash *install-engines.sh*), Bash(powershell *install-engines.ps1*), Bash(tail *), Bash(cat *), Bash(type *)
---

Install or repair REA's engines on the machine this session runs on. Normally this is not
needed: the plugin's SessionStart hook installs them automatically on first use. Use this
command when the hook reported a problem, the user disabled `auto_engines`, or an install
is suspected to be broken.

One command works on every OS — it detects Windows / macOS (Apple Silicon or Intel) /
Linux and the CPU architecture itself:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-engines.cjs"
```

1. First show what would happen: `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-engines.cjs" --dry-run`.
   It prints the platform, the target directory (`~/.rea-engines` unless configured), and
   which pieces are missing: a JDK 21 (Eclipse Temurin, only if no 64-bit JDK 21+ with
   `javac` is usable), Ghidra 12.1.4 (~570 MB, SHA-256 verified), jadx-headless-mcp 0.7.1,
   and on Linux the apt tools (radare2, binwalk, tshark, apktool, binutils, gdb).
2. If `~/.rea-engines/install.lock` exists and is recent, an install is already running in
   the background: show `tail -20 ~/.rea-engines/install.log` (Windows:
   `type %USERPROFILE%\.rea-engines\install.log`) and wait for `install.done`.
3. Otherwise run the installer in the foreground (same command without `--dry-run`). It is
   idempotent and prints what it skips and what it installs. Expect 1–5 minutes on first run.
   Useful flags: `--only ghidra,jadx,apktool,radare2`, `--no-jdk` (use the system Java),
   `--dir <path>`, `--force` (re-download a broken piece), `--upgrade` (move to the pinned
   versions in `rea-engines-lib.cjs`, removing older Ghidra/jadx copies after the new ones
   verify), `--write-config` (records the paths in `~/.rea-plugin.json`), on Windows
   `--set-env` (user environment variables for other tools) and `--wsl` (install the Linux
   engine set inside WSL; `--wsl-install` first runs `wsl --install -d Ubuntu`, which needs
   administrator rights and a reboot — tell the user before using it).
   Optional engines: `apktool` (jar + `apktool` wrapper on PATH) and `radare2` (Windows zip;
   macOS via Homebrew; Linux via apt) are installed when listed in `--only` / `"engines"`, or
   with `"optional_engines": true` together with `all`.
   Offline / slow networks: downloads resume from a `.part` file, and any release file placed
   in `~/.rea-engines/archives/` (or `REA_PLUGIN_ARCHIVE_DIR` / `"archive_dir"`) with its
   original name is used instead of the network after its SHA-256 is checked.
4. When it finishes, tell the user the resulting paths (`GHIDRA_INSTALL_DIR`,
   `REA_JADX_MCP_JAR`, `JAVA_HOME`) and that REA picks them up on the next `open_binary`
   call — no restart needed, the launcher auto-discovers `~/.rea-engines`.
5. If a download fails, say which URL failed and ask the user to allow `github.com`,
   `release-assets.githubusercontent.com`, `objects.githubusercontent.com` and
   `api.adoptium.net` through their proxy / cloud network settings, or to supply the files.
   A corporate proxy is honoured through `HTTPS_PROXY` (the installer uses `curl` when present).
6. Platform notes:
   - **Windows:** needs nothing pre-installed besides Node (bundled with Claude Desktop /
     required by Claude Code). Archives are extracted with the built-in `tar.exe`. For
     Linux-only tooling (binwalk, tshark, mitmproxy) suggest `"use_wsl": true` in
     `~/.rea-plugin.json`; inside WSL, `bash scripts/install-engines.sh` installs everything.
   - **macOS:** the installer clears the quarantine attribute and makes Ghidra's launch
     scripts executable, so no Gatekeeper prompts. Apple Silicon gets the aarch64 JDK and
     Ghidra's native `mac_arm_64` decompiler is used automatically.
   - **Linux / cloud:** `bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-engines.sh"` is the
     equivalent shell version and additionally installs the apt tools; the Node installer
     delegates to it for that step.
