# Clanker TODO

## Done
- Scaffold TS CLI: `clanker`, `clanker slave <n>`, `clanker status`, `clanker doctor`
- Config loader for `clanker.yaml` + defaults (`slaves: 3`)
- State dir `.clanker/` + state.json init
- tmux discovery + pane tracking stub
- TUI shell (blessed) stub
- events log + tail stream pipeline
- Escalation detection + auto-focus + toggle hotkey
- Worktree manager (`c-planner`, `c-judge`, `c<profileNum>-<desk>`)
- Context pack stubs + summaries
- Adopt modern official Yarn template (Berry) and set `packageManager`
- Task state store (`.clanker/tasks/*.json`)
- Scheduler stub (cap + pause/resume)
- Slave wrapper: runs `c` + heartbeat
- Heartbeat in dashboard HUD
- Assignment loop (tasks → slaves)
- Task prompt injection (tmux send-keys → codex)
- Pause/resume hotkeys in TUI
- `/` command prompt in TUI
- Task schema validation
- Task packet creation command
- Planner stub (plan docs → tasks)
- Planner runner (`clanker planner`) + plan prompt sender
- Plan task prompt schema
- Planner loop: read tasks + enforce schema (health check)
- Task packet schema hard validation (missing fields, invalid status)
- Job runner: auto-assign based on scheduler caps
- Scheduler caps in assignment loop
- Scheduler inputs (conflicts, backlog, burn)
- Task status transitions + judge/rework lifecycle events
- History summaries: write `slave` + `judge` notes to `.clanker/history/`
- Context pack builder usage in planner prompt (plan docs + recent history)
- Tail stream: tag color map + idle single-line update
- TUI styling pass (glitchcore palette + header animation)
- Task packet fields: ownerDirs/baseMainSha + validation in `health`
- Planner prompt injection: include acceptance checklist + tests
- Metrics rollup (`.clanker/metrics.json`)
- Health-check task for mainline behavior
- Task status helpers in TUI (quick actions)
- `clanker judge` command (codex spawn + heartbeat)
- Judge handoff packet writer (summary + tests + diffs → `.clanker/history/`)
- Token/cost tracking per task (events + HUD format)
- Planner prompt: self-contained instructions (no repo-local file refs)
- Raw chat logs in `.clanker/logs/` (planner/judge/slave)
- `clanker tail` command (events follow)
- Task archival/GC (`clanker task gc`)
- `clanker doctor --fix` (create missing dirs)
- TUI footer (version + config summary)
- Palette cleanup (remove TODO tag)
- Rework routing: resume slave, events for rework/handoff/blocked
- Sleep/offline resilience: wake detection + stale heartbeat events
- Task lock map: top-level dir lock with file-level overrides
- Conflict detection: git status diff + lock conflicts
- TUI feedback ribbon (condensed handoff feed)
- Pane focus UX: last-pane tracking + `b` hotkey
- Config: `slaves`, `tmuxSession`, `codexCommand`
- `clanker resume` command
- Planner split heuristic (large task -> split)
- Docs: quickstart + workflow diagram + glossary
- Health: baseMainSha drift + worktree checks
- Metrics: burn/backlog sparkline

## Now
- (none queued)

## Next
- (none queued)

## Later
- (none queued)
