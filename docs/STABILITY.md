# Stability guarantees (1.0)

REA for Claude 1.0 commits to the interfaces below. Within the 1.x line they are only
extended, never changed or removed; a break would mean 2.0. Anything not listed here
(internal script functions, log wording, the exact text of hook context) may change in any
release.

## `~/.rea-plugin.json` — configuration keys

Location: `~/.rea-plugin.json`, or the file `REA_PLUGIN_CONFIG` points to, or
`$CLAUDE_PLUGIN_DATA/config.json`. Unknown keys are ignored; blank strings are treated as
unset. A project may add `.rea-plugin.json` at its root for the `router` key only.

| Key | Type | Stable meaning |
|---|---|---|
| `rea_version` | string | npm version of `rea-agents` the launcher runs (`npx -y rea-agents@<v>`) |
| `ghidra_install_dir` | path | `GHIDRA_INSTALL_DIR` for REA; wins over auto-discovery |
| `jadx_mcp_jar` | path | `REA_JADX_MCP_JAR` for REA |
| `kuna_command` / `ida_mcp_config` / `browser_executable` | path | passed through as `REA_KUNA_COMMAND` / `REA_IDA_MCP_CONFIG` / `REA_BROWSER_EXECUTABLE` |
| `java_home` | path | JDK for Ghidra/jadx; the environment's `JAVA_HOME` wins, then this, then a bundled `~/.rea-engines/jdk-21` |
| `engines_dir` | path | root of the engines layout below (default `~/.rea-engines`) |
| `archive_dir` | path | extra directory searched for pre-downloaded release files (offline / mirror) |
| `auto_engines` | bool (default `true`) | install missing engines in the background on first use |
| `jdk` | bool (default `true`) | allow the installer to download a JDK when no JDK 21+ with `javac` is usable |
| `engines` | string[] (default `["all"]`) | which pieces the installer handles: `ghidra`, `jadx`, `apt`, `apktool`, `radare2`, `jdk`, `all` |
| `optional_engines` | bool (default `false`) | let `all` include the optional engines (`apktool`, `radare2`) |
| `router` | `true` / `false` / `{ "allow": [regex], "deny": [regex] }` | automatic routing of reverse-engineering prompts to REA; deny wins over allow |
| `use_wsl` / `wsl_distro` | bool / string | Windows: run REA inside WSL; engine paths are translated `C:\…` → `/mnt/c/…` |
| `rea_command` | string | run this instead of `npx` (`rea`, or a path to `rea.mjs`) |
| `report.format` / `report.dir` / `report.theme` | `html`·`md`·`json`·`both`·`all` / path / theme name | defaults for `/rea:report` and `make-report.mjs` |
| `env` | object | extra variables passed to the REA process (set only when not already set) |

Environment equivalents keep their names: `REA_PLUGIN_CONFIG`, `REA_PLUGIN_ENGINES_DIR`,
`REA_PLUGIN_ARCHIVE_DIR`, `REA_PLUGIN_ENGINES`, `REA_PLUGIN_OPTIONAL_ENGINES`,
`REA_PLUGIN_AUTO_ENGINES`, `REA_PLUGIN_SKIP_JDK`, `REA_PLUGIN_ROUTER`, `REA_PLUGIN_USE_WSL`,
`REA_PLUGIN_VERSION`, `REA_PLUGIN_REA_COMMAND`, and the `REA_PLUGIN_<ENGINE>` forms used by
the Claude Desktop extension. Precedence per value: **REA env var → `REA_PLUGIN_*` env →
config file → auto-discovery**.

## `~/.rea-engines` — layout

```
~/.rea-engines/
  ghidra_<version>_PUBLIC/        Ghidra release as extracted (support/analyzeHeadless …)
  jadx-headless-mcp-<v>-all.jar   jadx MCP bridge jar
  jdk-21/                         Temurin JDK (macOS: jdk-21/Contents/Home is JAVA_HOME)
  apktool_<v>.jar                 optional
  bin/                            wrappers put first on PATH (apktool, …)
  radare2/                        optional, Windows (bin/radare2.exe)
  archives/                       offline/mirror input: release files by their original name
  install.lock                    present while an installer runs (stale after 30 min)
  install.done                    ISO timestamp of the last successful install
  install.log                     installer output
  engines.json                    what is installed: paths, versions, platform
```

Discovery rules that stay fixed: the highest `ghidra_*_PUBLIC` directory with a `support/`
folder is used, preferring the pinned version; the highest `jadx-headless-mcp-*-all.jar`;
`jdk-*` resolved through `Contents/Home` on macOS. Anything the launcher discovers here is
overridden by the configuration keys above and by the plain REA environment variables.

## Command-line surfaces

* `node scripts/launch-rea.cjs [mcp]` starts the server; `launch-rea.cjs doctor [...]` runs
  REA's doctor with the same resolved environment.
* `node scripts/install-engines.cjs` flags: `--dry-run`, `--only <list>`, `--dir`, `--force`,
  `--upgrade`, `--no-jdk`, `--write-config`, `--set-env`, `--wsl`, `--wsl-install`,
  `--background`. Exit 0 on success, 1 when a step failed, 2 for an unsupported platform.
* `node scripts/ensure-engines.cjs [--status]` prints one verdict line, and with `--status`
  a per-engine table where each broken row ends with `→ <repair command>`.
* `node scripts/rea-router.cjs --test|--why "<prompt>"` prints a JSON decision with
  `reverseEngineering`, `type`, `reason`, `rule`.
* `node scripts/make-report.mjs` flags: `--out`, `--format html|md|json|both|all`, `--theme`,
  `--title`, `--bundle [file]`, `--stdin`, `--diff <before> <after>`.

## File formats

* Report JSON: `schema: "rea-for-claude/report@1"` — `targets[] → { key, subject, evidence[] }`,
  each evidence with `operation`, `provider`, `confidence`, `limitations`, `result`, `raw`.
* Diff JSON: `schema: "rea-for-claude/diff@1"` — `before`, `after`, `summary`, `entries[]`.
* Evidence bundle: `{ rea_bundle: { schema: "rea-for-claude/bundle@1", created, host, count,
  digests[] }, evidence[] }`. Accepted wherever a file or directory is.

New fields may be added to each `@1` schema; existing fields keep their meaning. A removed
or re-typed field bumps the schema number.

## Engine version policy

Versions and checksums live in one place, `scripts/rea-engines-lib.cjs` (`VERSIONS`), with
copies in `install-engines.sh` / `.ps1` for shell-only hosts. A release that moves a pin says
so in its notes; `install-engines.cjs --upgrade` moves an existing `~/.rea-engines` to the
new pins and removes the older Ghidra / jadx / apktool copies only after the new ones have
verified. Kuna, IDA and Hopper are never downloaded by this plugin.
