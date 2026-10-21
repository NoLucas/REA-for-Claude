---
description: Explain why the last request was (or was not) routed to REA automatically, and how to tune the router (opt-out, allow/deny patterns)
argument-hint: [prompt text to test]
allowed-tools: Bash(node *rea-router.cjs*), Bash(cat *)
---

Explain the REA router's decision for a prompt.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/rea-router.cjs" --why "$ARGUMENTS"` — if no
   argument was given, use the user's previous message as the prompt text.
2. Report in one or two sentences: whether it was routed (`reverseEngineering`), the
   `rule` that decided it (strong reverse-engineering signal, binary file + analysis verb,
   allow/deny pattern, router disabled, other slash command, no signal), the playbook
   `type` chosen, and the effective config (`enabled`, `allow`, `deny`, `projectFile`).
3. If the user wanted a different outcome, tell them the one-line fix:
   - route this kind of prompt always → add an `allow` regex to `"router"` in
     `~/.rea-plugin.json` (or a project `.rea-plugin.json` in the repo root, which overrides);
   - never route it → add a `deny` regex (deny wins over allow);
   - turn the router off → `"router": false` (or `REA_PLUGIN_ROUTER=0` for one session);
   - a binary file name alone is not enough: add an analysis verb ("analyze", "decompile",
     "what does … do", 분석) or use `/rea:analyze <file>` explicitly.
4. Routing never blocks anything: it only adds context telling Claude to use REA. When in
   doubt, `/rea:analyze <file>` always works.
