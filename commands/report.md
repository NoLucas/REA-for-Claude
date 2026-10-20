---
description: Build a shareable HTML/Markdown report from saved REA evidence JSON files
argument-hint: [evidence-dir] [--format html|md|both] | --diff <before-dir> <after-dir>
allowed-tools: Bash(node *make-report.mjs*), Bash(ls *), Bash(cat *), Bash(mkdir *)
---

Turn saved REA evidence into a report.

1. Evidence location: use `$1` if given, else `./rea-evidence/`. If it is empty or missing,
   tell the user to run `/rea:analyze` first (or to save REA tool results as `.json` files),
   and stop.
2. Read the report format from the user's config when present (`~/.rea-plugin.json` →
   `report.format` / `report.dir`); otherwise default to `html` into `./rea-reports/`. A
   `--format` argument in `$2` overrides.
3. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/make-report.mjs" <evidence-dir> --out <report-dir> --format <fmt>`
   (from a clone without the plugin env, use `scripts/make-report.mjs`). The tool prints JSON
   with the written file paths.
4. **Diff mode:** if the user passed `--diff <before> <after>` (two evidence directories,
   e.g. two builds of the same app), run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/make-report.mjs" --diff <before> <after> --out <report-dir> --format <fmt>`
   instead. The result lists same/changed/added/removed evidence, field-level changes,
   added/removed procedures/strings/segments, and a line diff of decompiled code.
5. Deliver the generated report file to the user. On claude.ai, also open the HTML as an
   artifact so they can view it inline. Mention that the report content is untrusted data
   extracted from the analysed target.
