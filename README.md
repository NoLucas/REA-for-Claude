<p align="right"><b>English</b> | <a href="README.ko.md">한국어</a></p>

# REA for Claude — Reverse Engineer Anything, anywhere

A Claude plugin that packages [REA (Reverse Engineer Anything)](https://github.com/morluto/rea)
so it runs **wherever your Claude session runs**. Upstream REA assumes a "local stdio MCP server +
local analysis engines" setup, which effectively limits it to the Claude Code terminal. This
repository removes that assumption in four ways.

| Where it runs | How | Needs your PC | Verified |
|---|---|---|---|
| **claude.ai cloud sessions** (web, mobile, claude.ai/code) | Attach this repo to a session: `.mcp.json` starts REA inside the container and **Ghidra 12.1.4 + jadx install automatically** | ✗ | ✅ Ghidra decompilation confirmed in a real session |
| **Claude Desktop + linked claude.ai sessions** | REA runs on your PC; the desktop app relays its tools into the session, so you can keep going from your phone | ✓ (must stay on) | ⚠️ Uses the path the REA team verified on Windows 11 |
| **Local Claude Code** | Plugin install or `.mcp.json` | ✓ | ✅ |
| **Remote appliance** (Docker + tunnel → custom connector) | Bake REA + engines on an always-on server and expose it over HTTPS | a server | ⚠️ Each component verified; `docker build` itself not run |

> Reverse engineering must respect the target software's license, terms of service and local
> law. Read upstream REA's [DISCLAIMER](https://github.com/morluto/rea/blob/main/DISCLAIMER.md).

---

## 1. claude.ai cloud sessions (no PC required)

This is the path that goes "beyond REA": REA and Ghidra run in Anthropic's cloud container
(Ubuntu 24.04 with JDK 21 preinstalled), and the session continues seamlessly from your phone.

1. Push this repository to your GitHub (private is fine).
2. Start a new session on it at [claude.ai/code](https://claude.ai/code), or add the repository
   to a session from a regular chat.
3. When the session starts, the SessionStart hook in `.claude/settings.json` installs the
   engines **in the background** (`~/.rea-engines`, about 1–3 minutes, log in
   `~/.rea-engines/install.log`) and `.mcp.json` starts the REA server right away. For tools
   that need Ghidra, call `open_binary` again once the install has finished — REA resolves
   providers at call time, so no restart is needed.
4. Commit the files you want to analyse to the repository or attach them to the session, and
   `open_binary` them by absolute path.

**Faster (recommended):** in claude.ai/code → your environment settings, set
- Setup script: `bash scripts/install-engines.sh`
- Environment variables: `GHIDRA_INSTALL_DIR=/root/.rea-engines/ghidra_12.1.4_PUBLIC`,
  `REA_JADX_MCP_JAR=/root/.rea-engines/jadx-headless-mcp-0.7.1-all.jar`

The install then finishes before the session starts and the result is cached (the home
directory may be `/home/…` in your environment — check `echo $HOME` in a first session).
The default **Trusted** network access level is enough (github.com,
release-assets.githubusercontent.com and archive.ubuntu.com are used).

Measured: install in 1 min 46 s on a 2-vCPU container; ~20 s per decompile call on a small ELF.

## 2. Claude Desktop (+ linked claude.ai sessions)

REA runs on your PC and the desktop app relays its tools. A session linked to the PC keeps
showing the REA tools even when you continue it from your phone (the PC and the desktop app
must stay running).

```powershell
# 1) Install Node.js 22/24, quit Claude Desktop completely (tray icon too), then in a normal terminal:
npx rea-agents@6.7.0 setup --client claude_desktop
# 2) Restart Claude Desktop → Settings > Developer: the rea server should be listed
```

For engine paths, system environment variables (`GHIDRA_INSTALL_DIR`, `REA_JADX_MCP_JAR`)
fit REA's official setup best. If you prefer this plugin's launcher, point the `rea` entry in
`claude_desktop_config.json` at `node <repo>/scripts/launch-rea.cjs`; that enables the config
file and WSL mode described below.

**Windows limits and WSL:** native Windows REA covers Ghidra x86/x64/ARM PE targets and the
engine-free providers; Linux-only tooling (binwalk, tshark, mitmproxy) is unavailable. Set
`"use_wsl": true` in `~/.rea-plugin.json` and the launcher runs REA inside `wsl.exe`, giving
you the full Linux toolset (engine paths are then Linux paths). Inside WSL,
`bash scripts/install-engines.sh` installs every engine in one go.

> In case the desktop app starts the plugin's MCP server itself when the plugin is installed
> through claude.ai, the server definition **does not depend on plugin user settings
> (userConfig)** — the desktop cannot supply those and the server would never start. Every
> setting is resolved from environment variables, `~/.rea-plugin.json` or auto-discovery.

## 3. Local Claude Code

```bash
claude plugin marketplace add NoLucas/REA-for-Claude
claude plugin install rea@rea-for-claude
# or, from a clone of the repository
claude --plugin-dir ./REA-for-Claude
```

Then `/rea:doctor`. On Linux, `/rea:install-engines` installs the engines as well.

## 4. Remote appliance (anywhere, even with your PC off)

The Dockerfile and docker-compose in `remote/` bake REA + Ghidra + jadx +
radare2/binwalk/tshark/apktool into a Linux container and expose it as Streamable HTTP. Put a
Cloudflare tunnel in front and add the URL under claude.ai **Settings → Connectors → Add custom
connector**: the REA tools then appear in web, mobile, desktop and cloud sessions alike. Steps
and the **security notes** are in [remote/README.md](remote/README.md).

---

## Config file `~/.rea-plugin.json`

Every key is optional and blank values are ignored. Precedence: real REA environment variables
→ `REA_PLUGIN_*` environment variables → this file → auto-discovery in the engines directory
(`~/.rea-engines`).

```json
{
  "rea_version": "6.7.0",
  "ghidra_install_dir": "C:\\tools\\ghidra_12.1.4_PUBLIC",
  "jadx_mcp_jar": "C:\\tools\\jadx-headless-mcp-0.7.1-all.jar",
  "kuna_command": "",
  "ida_mcp_config": "",
  "engines_dir": "",
  "auto_engines": false,
  "use_wsl": false,
  "wsl_distro": "Ubuntu",
  "env": { "REA_GHIDRA_STARTUP_TIMEOUT_MS": "600000" }
}
```

Copy `scripts/rea-config.example.json` to start from. `auto_engines` defaults to on in cloud
sessions (`CLAUDE_CODE_REMOTE`) and off everywhere else.

## What's inside

```
.claude-plugin/plugin.json      plugin manifest (MCP server → scripts/launch-rea.cjs)
.claude-plugin/marketplace.json the repository doubles as a marketplace
.mcp.json                       project MCP definition for cloud/local sessions (loads without a prompt)
.claude/settings.json           cloud-session SessionStart hook: background engine install
scripts/launch-rea.cjs          universal launcher (config file, auto-discovery, cloud auto-install, WSL)
scripts/install-engines.sh      Linux engine installer (Ghidra 12.1.4 SHA-256 verified, jadx, apt tools)
skills/reverse-engineer-anything REA's official investigation skill (207 tools, MIT)
skills/rea-anywhere             per-environment operating notes (handling provider_unavailable, etc.)
commands/doctor, capabilities, install-engines
remote/                         Docker appliance + Cloudflare tunnel
```

## How it works and why

- **Why a launcher sits in between** ① hosts may pass blank settings as `""`, which REA
  rejects as "not an absolute path", so blanks must be dropped; ② in the cloud the server has
  to start immediately and fetch engines afterwards to stay under the MCP startup timeout;
  ③ the Windows → WSL branch.
- **Why deferred installation works** REA resolves the Ghidra provider when `open_binary`
  is called, not at server start (confirmed by test). Re-open the target after the install.
- **Why both `.mcp.json` and `plugin.json`** cloud/local sessions read the project
  `.mcp.json`; plugin installs read `plugin.json`. Both define the same `rea` server, and the
  latter wins when installed as a plugin.
- `rea mcp --http` (native Streamable HTTP) exists on REA's `main` but is not in npm 6.7.0, so
  the remote appliance bridges with `supergateway`. Swap it out once the next release ships.

## Limits

- Cloud containers are typically 2 vCPU / 8 GB, so large binaries are slow. Raise
  `REA_GHIDRA_STARTUP_TIMEOUT_MS`, run the full analysis once and use per-function calls.
- IDA, Kuna and Hopper are commercial or manually installed engines; they are not part of the
  cloud auto-install.
- macOS-only providers (asset catalogs, etc.) work only on macOS.
- If you already registered REA with `npx rea-agents setup` for the same client, keep only
  one of the two registrations.

## License

Plugin wrapper: MIT. `skills/reverse-engineer-anything/` is copied verbatim from
[morluto/rea](https://github.com/morluto/rea) under MIT (`LICENSE.rea`). REA itself is not
bundled; it is fetched from npm at run time. Ghidra is Apache-2.0; jadx-headless-mcp follows its
own repository's license.
