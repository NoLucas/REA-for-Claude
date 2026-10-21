---
description: Build a shareable HTML/Markdown/JSON report (themes, evidence bundles) from saved REA evidence JSON files, or diff two evidence sets / bundles
argument-hint: [evidence-dir|bundle] [--format html|md|json|both|all] [--theme violet|ocean|forest|amber|mono|contrast] [--bundle] | --diff <before> <after>
allowed-tools: Bash(node *make-report.mjs*), Bash(ls *), Bash(cat *), Bash(mkdir *)
---

Turn saved REA evidence into a report.

1. Evidence location: use `$1` if given, else `./rea-evidence/`. If it is empty or missing,
   tell the user to run `/rea:analyze` first (or to save REA tool results as `.json` files),
   and stop.
2. Read the defaults from the user's config when present (`~/.rea-plugin.json` →
   `report.format` / `report.dir` / `report.theme`); otherwise `html`, `./rea-reports/`,
   theme `violet`. `--format`, `--theme`, `--out` arguments override.
3. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/make-report.mjs" <evidence-dir> --out <report-dir> --format <fmt> [--theme <t>] [--bundle]`
   (from a clone without the plugin env, use `scripts/make-report.mjs`). The tool prints JSON
   with the written file paths. `--format json` (or `all`) writes a normalised model
   (`rea-for-claude/report@1`: targets → evidence with operation, provider, confidence,
   limitations, rendered result, raw) for downstream tooling. `--bundle` additionally writes
   `<name>.rea-bundle.json`: every evidence object plus a manifest (host, time, digests) —
   the file to send to another machine or keep as the "before" of a later comparison.
4. **Diff mode:** if the user passed `--diff <before> <after>` (two evidence directories or
   two `*.rea-bundle.json` files, e.g. two builds of the same app analysed on different
   machines), run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/make-report.mjs" --diff <before> <after> --out <report-dir> --format <fmt> [--theme <t>]`
   instead. The result lists same/changed/added/removed evidence, field-level changes,
   added/removed procedures/strings/segments, and a line diff of decompiled code; with
   `--format json` the diff model (`rea-for-claude/diff@1`) is written too.
5. Deliver the generated report file to the user. On claude.ai, also open the HTML as an
   artifact so they can view it inline. Mention that the report content is untrusted data
   extracted from the analysed target.
