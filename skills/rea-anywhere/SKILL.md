---
name: rea-anywhere
description: Operating notes for the REA plugin's MCP server in each place a Claude session can run — local Claude Code on Windows / macOS / Linux and claude.ai cloud sessions (engines auto-install in the background on all of them), Claude Desktop / claude.ai sessions linked to a computer (tools named mcp__remote-devices__plugin_rea_rea__*), and the remote Docker appliance. Use when a REA tool returns provider_unavailable, when there are no mcp__rea__* tools, when Ghidra/jadx/Java seem missing, before the first REA call in a fresh session, or when the user asks where to put a target file.
---

# REA anywhere

The `rea` MCP server is started by `scripts/launch-rea.cjs`. It resolves engines
(Ghidra, jadx, Kuna, IDA) and the JDK from the environment, `~/.rea-plugin.json`, or the
engines directory (`~/.rea-engines` by default). Use the REA tools directly; read this
only when something is missing.

## How engines get installed (every OS)

1. **SessionStart hook** (`scripts/ensure-engines.cjs`) runs when the plugin is enabled.
   In well under a second it checks `~/.rea-engines`; if Ghidra, jadx, or a usable
   64-bit JDK 21+ is missing it starts `scripts/install-engines.cjs` detached in the
   background and prints one status line into the session context (`REA: engines
   ready…` / `REA: installing … in the background…` / `REA: engines missing…`).
   Read that line before the first REA call.
2. **Installer** picks downloads for `process.platform` + `process.arch`: Eclipse Temurin
   JDK 21 (only when no JDK 21+ with `javac` is usable), Ghidra 12.1.4 (SHA-256
   verified), jadx-headless-mcp 0.7.1, and on Linux the apt tools. Windows x64, macOS
   Apple Silicon and Intel, Linux x64 and arm64 are supported. Progress is in
   `~/.rea-engines/install.log`; `install.done` marks completion; `engines.json` records
   what was installed.
3. **Launcher** starts REA immediately with the paths the installer will produce and, when
   `~/.rea-engines/jdk-21` exists, exports it as `JAVA_HOME` (user-set `JAVA_HOME` or
   `config.java_home` win). REA resolves providers per call, so nothing needs restarting.

Opt out with `"auto_engines": false` in `~/.rea-plugin.json` (then `/rea:install-engines`
installs on demand), `"jdk": false` to never download a JDK, or `"engines": [...]` to
choose pieces.

## When a tool answers `provider_unavailable` for Ghidra or jadx

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/ensure-engines.cjs" --status` — says whether an
   install is running, finished, or missing.
2. If running: `tail -5 ~/.rea-engines/install.log` (Windows: `type
   %USERPROFILE%\.rea-engines\install.log`) and wait for `done`. Ghidra is ~570 MB.
3. Call `open_binary` on the target **again**. A target opened before the install
   finished stays bound to the engine-free candidates until it is re-opened.
4. If the log shows a failed download, run `/rea:install-engines` in the foreground and
   read its output (network allow-list: `github.com`, `release-assets.githubusercontent.com`,
   `objects.githubusercontent.com`, `api.adoptium.net`).

## Cloud sessions (claude.ai / claude.ai/code, `CLAUDE_CODE_REMOTE` is set)

- **The plugin's MCP server is not loaded here.** Cloud sessions set
  `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1`: skills, hooks and commands load, plugin-declared MCP
  servers do not. REA's tools can still reach the session two ways:
  1. **Linked computer** — if the session is linked to a computer whose Claude desktop app has
     the REA plugin, its tools appear as `mcp__remote-devices__plugin_rea_rea__*` (often
     deferred: search for `open_binary`). Use them; see the linked-computer section below.
  2. **Project registration** — `mcp__rea__*` tools exist when the project registers the server
     itself: a session started on the REA-for-Claude repository has that (`.mcp.json`); any
     other repository needs `/rea:setup-mcp` once (writes `.mcp.json`, `.claude/rea-mcp.cjs`,
     `.claude/settings.json`), committed, then a new session. A session without a repository
     cannot keep those files — they vanish with the container.
  The SessionStart hook's `REA: the REA MCP server is NOT loaded` line covers both. With neither,
  tell the user REA is unavailable in this session and offer `/rea:start`; do not analyse by
  hand and present it as REA output.
- Same flow as above; the repo's `.claude/settings.json` hook triggers it, so engines are
  usually ready 1–3 minutes after the session starts. REA itself is available immediately
  for engine-free providers (managed .NET static analysis, artifact graphs,
  JavaScript/Electron static analysis).
- Target files: anything in the repository checkout or uploaded to the session is a
  local path REA can open. Use absolute paths (`pwd` + relative). Copy files out of
  `/mnt/user-data/uploads` before analysis if that directory is read-only.
- Resources are modest (typically 2 vCPU / 8 GB): one Ghidra call on a small ELF takes
  ~20 s; large binaries need `REA_GHIDRA_STARTUP_TIMEOUT_MS` (set it in
  `~/.rea-plugin.json` under `env`) and patience. Prefer `analyze` once, then targeted
  `procedure_pseudo_code` / `search_strings` calls over repeated full analyses.

## Local Claude Code (Windows, macOS, Linux)

- Nothing to pre-install besides Node: the first session with the plugin enabled installs
  the engines into `~/.rea-engines` (`%USERPROFILE%\.rea-engines` on Windows).
- Windows: native REA covers Ghidra x86/x64/ARM PE targets, Android via jadx, and the
  engine-free providers. Linux-only tooling (binwalk, tshark, mitmproxy) needs
  `use_wsl: true` in `~/.rea-plugin.json` with Linux engine paths; inside WSL,
  `bash scripts/install-engines.sh` installs everything.
- macOS: the installer clears the quarantine attribute and fixes execute bits, so Ghidra's
  headless analyzer runs without Gatekeeper prompts. Apple Silicon uses the aarch64 JDK and
  Ghidra's `mac_arm_64` native decompiler automatically.
- `/rea:doctor` shows what is configured, including which JDK Ghidra will use.

## Claude Desktop and claude.ai sessions linked to a computer

- REA runs on the user's computer; its tools are relayed into the session. In a claude.ai
  session they are named `mcp__remote-devices__plugin_rea_rea__<tool>` (for example
  `…__open_binary`, `…__binary_session`) instead of `mcp__rea__<tool>`; the arguments are the
  same. Paths are paths on that computer (Windows paths on Windows). The computer must stay on
  with the Claude desktop app running.
- The SessionStart hook and `ensure-engines.cjs --status` run in the cloud container, so their
  engine lines describe the container, not the user's computer. Call the relayed
  `binary_session` to see the computer's engines.
- Files on the user's computer: analyse them where they are with the relayed tools (ask the
  user for the path). Files uploaded to the cloud session are not visible to the computer's
  REA.
- The `.mcpb` extension uses the same launcher, so it auto-discovers `~/.rea-engines`; if
  the engines are missing there, the launcher starts the same background install.
- Nothing else can be installed on the user's computer from the session unless a device
  shell tool is available; otherwise give the user the exact command to run.

## Remote appliance (Docker, custom connector)

- Targets must be placed in the container's `/targets` volume by the user; REA opens
  them as `/targets/<name>`. Engines are baked into the image, so `provider_unavailable`
  there means the target format is unsupported, not that the engine is missing.

## Do not

- Do not run `npx rea-agents setup` from inside a session where the plugin already
  provides the server; it would register a duplicate `rea` server.
- Do not edit `GHIDRA_INSTALL_DIR` to a relative path; REA rejects relative paths.
- Do not start a second installer while `~/.rea-engines/install.lock` is fresh; it exits
  immediately by design.
