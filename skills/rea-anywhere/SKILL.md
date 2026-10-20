---
name: rea-anywhere
description: Operating notes for the REA plugin's MCP server in each place a Claude session can run — claude.ai cloud sessions (engines auto-install in the background), Claude Desktop / linked sessions, local Claude Code, and the remote Docker appliance. Use when a REA tool returns provider_unavailable, when Ghidra/jadx seem missing, before the first REA call in a fresh cloud session, or when the user asks where to put a target file.
---

# REA anywhere

The `rea` MCP server is started by `scripts/launch-rea.cjs`. It resolves engines
(Ghidra, jadx, Kuna, IDA) from the environment, `~/.rea-plugin.json`, or the engines
directory (`~/.rea-engines` by default). Use the REA tools directly; read this only
when something is missing.

## Cloud sessions (claude.ai / claude.ai/code, `CLAUDE_CODE_REMOTE` is set)

- On first start the launcher downloads Ghidra 12.1.4 (~570 MB) and jadx-headless-mcp
  into `~/.rea-engines` **in the background** (`~/.rea-engines/install.log`). It takes
  about 1–3 minutes. REA itself is available immediately for engine-free providers
  (managed .NET static analysis, artifact graphs, JavaScript/Electron static analysis).
- If a tool answers `provider_unavailable` for Ghidra or jadx:
  1. `tail -5 ~/.rea-engines/install.log` — wait until it prints `done`.
  2. Call `open_binary` on the target **again**. REA resolves providers per call; no
     restart is needed. (A target opened before the install finished stays bound to the
     engine-free candidates until it is re-opened.)
- If the log shows a download failure, run `/rea:install-engines` or
  `bash scripts/install-engines.sh` and read its output.
- Target files: anything in the repository checkout or uploaded to the session is a
  local path REA can open. Use absolute paths (`pwd` + relative). Copy files out of
  `/mnt/user-data/uploads` before analysis if that directory is read-only.
- Resources are modest (typically 2 vCPU / 8 GB): one Ghidra call on a small ELF takes
  ~20 s; large binaries need `REA_GHIDRA_STARTUP_TIMEOUT_MS` (set it in
  `~/.rea-plugin.json` under `env`) and patience. Prefer `analyze` once, then targeted
  `procedure_pseudo_code` / `search_strings` calls over repeated full analyses.

## Claude Desktop and claude.ai sessions linked to a computer

- REA runs on the user's computer; its tools are relayed into the session. Paths are
  paths on that computer (Windows paths on Windows). The computer must stay on with the
  Claude desktop app running.
- On Windows, native REA covers Ghidra x86/x64/ARM PE targets and the engine-free
  providers; Linux-only tooling (binwalk, tshark, mitmproxy) needs `use_wsl: true` in
  `~/.rea-plugin.json`, with Linux paths for the engines.
- Nothing can be installed on the user's computer from the session unless a device
  shell tool is available; otherwise give the user the exact command to run.

## Local Claude Code

- `/rea:doctor` shows what is configured. Missing engines are reported with the exact
  variable to set. Set them in `~/.rea-plugin.json` or the shell environment, then
  restart Claude Code (or `/mcp` → reconnect `rea`).

## Remote appliance (Docker, custom connector)

- Targets must be placed in the container's `/targets` volume by the user; REA opens
  them as `/targets/<name>`. Engines are baked into the image, so `provider_unavailable`
  there means the target format is unsupported, not that the engine is missing.

## Do not

- Do not run `npx rea-agents setup` from inside a session where the plugin already
  provides the server; it would register a duplicate `rea` server.
- Do not edit `GHIDRA_INSTALL_DIR` to a relative path; REA rejects relative paths.
