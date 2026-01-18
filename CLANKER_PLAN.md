# Clanker Harness Plan

## Scope
- Node harness; config YAML + state dir; blessed TUI; tmux attach
- Resume on sleep/offline; no background daemon
- Roles: planner / judge / slave

## Config + State
- `clanker.yaml` (repo root, settings)
- `.clanker/` (state/events/logs/heartbeat/attach/history)
- Defaults: `slaves: 3`

## CLI
- `clanker` → controller + TUI
- `clanker slave 1` → run slave `c1`
- `clanker status` → summary
- `clanker doctor` → env/attach/worktree checks

## tmux attach
- `c1` alias: set pane title `clanker:c1`, run `clanker slave 1`
- Controller: `tmux list-panes -a -F '#{pane_id} #{pane_title}'`
- Attach order: existing panes first, then auto-spawn if `slaves` > panes

## Scheduler
- Adaptive concurrency, hard slave cap; LLM may go lower only
- Inputs: readyCount, phase, conflictRate, integrationBacklog, tokenBurn
- Phases: explore (parallel), execute (medium), integrate (low N)
- Throttle on conflicts; expand on low conflicts + high readyCount

## Task routing
- Default lock: top-level dir ownership
- Optional `ownerFiles[]` for hot dirs
- Conflict detect: watcher + `git status --porcelain`

## Retries
- Exponential backoff + jitter; cap 30s; infinite retries
- Retriable: offline, 429, 5xx, timeouts
- Out-of-tokens: replan/split, not blind retry

## Resilience
- Atomic writes to `clanker.yaml` + append `events.log`
- Heartbeats per slave; reconcile on wake
- Clean SIGTERM/SIGINT checkpoint

## Handoff + Failure Modes
- Slave completes task, runs verification, writes summary, marks `needs_judge`
- Judge independently verifies; writes summary + verdict
- No mainline until judge says `done`
- Rework: same task stays unmerged; same slave pauses, resumes work, re-submits
- Follow-up tasks: only after task is accepted/mainlined (post-merge improvements)
- Blocked: task waits; planner may split or re-scope; still unmerged

## Mainlining + Conflicts + Regressions
- Mainlining performed by judge (integration phase, low N)
- Flow: judge rebases task worktree onto `main`, resolves conflicts, runs gate
- Conflict policy: fix in same task/worktree; if overlap indicates bad plan, planner re-scopes and reassigns
- If conflicts exceed budget, task goes `rework` or `split`
- Regression detection: local gate failures or local tests create auto regression tasks
- Regression tasks: tagged `regression`, highest priority, assigned immediately
- Periodic health-check task: verify `main` app behavior matches current plan/state

## Planner Inputs (Capped)
- Inputs: plan docs + current tasks + recent history summaries
- Cap growth: rolling window + compaction
- Strategy: keep last N task summaries + weekly rollups; prune by recency + relevance
- Build a bounded "context pack" per planning run (size limit)

## History Summaries (What to note)
- Outcome + files touched + commands run
- Decisions/assumptions + rationale
- Errors + fixes + known hazards
- TODOs + follow-ups
- Test results + missing tests

## TUI (blessed)
- Glitchcore palette (3–4 colors)
- ANSI/figlet header
- RUN label: per-char brightness animation
- Hotkeys: codex/claude style + `/` command prompt
- Tail panel: mid-level dev-oriented concise feedback stream

### Tail Stream Spec
- Format: `TAG | t+5m | tok 1.2k $0.41 | slave | task | short message | files/tests`
- Tags: 4 chars padded, leet allowed (e.g., `INFO`, `RISK`, `BLOK`, `TODO`, `FIX`, `TEST`, `DONE`)
- Length: <= 140 chars; truncate with `…`
- Cadence: task start/finish, retry/backoff, errors, test runs
- Include file refs when relevant (paths only)
- Highlight blockers + risks; separate `BLOK` from `RISK`
- Elapsed: short units (`5m`, `2h`, `3d`, `3mo`)
- Token spend: per-task total, include cost (`tok 1.2k $0.41`)
- If judge cost >15% of task cost, append judge cost in accent color
- Color map: `INFO` gray, `RISK` yellow, `BLOK` red, `TODO` cyan, `FIX` green, `TEST` blue, `DONE` magenta
- Idle: single bottom-line status (no repeats); update in place via TUI state, not append
