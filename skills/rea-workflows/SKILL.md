---
name: rea-workflows
description: Step-by-step REA investigation playbooks per target type (native executable/library, Android APK, Electron/JavaScript app, firmware/packed image, web bundle) and how to collect evidence into a shareable report. Use when the user asks to reverse engineer, analyze, decompile, understand, or compare a binary/app/firmware/bundle with REA, or runs /rea:analyze or /rea:report.
---

# REA investigation workflows

Pick the playbook for the target, run REA's own tools (the `reverse-engineer-anything`
skill has the full tool reference and recovery steps), and **save each tool result as a
`.json` file** so `/rea:report` can turn them into a shareable report. Use absolute paths.
Always confirm the engine is ready first (`/rea:doctor`); if a call returns
`provider_unavailable`, see the `rea-anywhere` skill.

General loop for every target:
1. `open_binary` (or the type-specific open tool) on the absolute path → note the target is
   now the active document.
2. Inventory once (overview / class list / export map), then make **targeted** follow-up
   calls. Re-running full analysis is expensive, especially on small cloud containers.
3. Save results to `./rea-evidence/<name>.json` (one file per call).
4. When done, run `/rea:report` to build the HTML/Markdown report, then deliver it.

## Native executable or library (ELF, PE, Mach-O)

1. `open_binary <path>` — confirm format/architecture.
2. `analyze` (or `read_binary_inventory_summary`) → segment/procedure/string counts.
3. `search_strings` for leads (URLs, keys-looking blobs, error messages, version strings).
4. For each interesting procedure: `procedure_pseudo_code <name-or-0xaddress>` to decompile.
   Symbol-stripped binary? Start from the entry point (`readelf -h`/PE header) and follow
   calls. `annotate_native_function` records what you learn.
5. Call graph / references: use the function-reference and call-relationship tools to trace
   who calls what, rather than decompiling everything.
6. Compare two builds with `compare` / `compare_managed_members` when asked "what changed".

## Android APK

1. `open` the APK with the jadx-backed tool; `decode_android_resources` for manifest,
   permissions, strings.
2. `search_android_classes` (empty query inventories all classes) to map the app, then
   decompile the classes that matter (entry activities, network, crypto, auth).
3. Pull native libraries out and treat each `.so` with the native playbook above.
4. Report: permissions, notable endpoints/keys, and the decompiled classes you relied on.

## Electron / JavaScript application

1. `analyze-javascript-application` / `analyze-web-bundle` to statically reconstruct the app
   graph from the shipped bundle — no execution.
2. Query selected facts (exports, routes, IPC listeners) instead of dumping everything.
3. `compare_javascript_export_shapes` / `compare-application-versions` for "what changed".
4. For Electron, check fuses and main-process entry; keep each finding as evidence.

## Firmware / packed image

1. Use the firmware/unpack tools (binwalk/unblob-backed) to carve the image; each extracted
   artifact becomes its own target (native playbook, SQLite inspector, etc.).
2. Keep the carve manifest as evidence so the report shows what was inside.

## Web target (live page)

1. Capture with a bounded browser scenario; prefer passive capture first.
2. Discover page-declared tools/endpoints; never submit forms or sign in as part of analysis.

## Turning evidence into a report

- Save every REA result you want in the report as a JSON file under `./rea-evidence/`.
- Run `/rea:report` (or `node "${CLAUDE_PLUGIN_ROOT}/scripts/make-report.mjs" ./rea-evidence --format html`).
- Deliver the generated file to the user. On claude.ai you can also open the HTML as an
  artifact. Remember the rendered strings are untrusted content from the target.
