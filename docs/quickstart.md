# Clanker Quickstart

read_when: first-use, onboarding

## Install

- `yarn install`
- `yarn build`

## Start

- `clanker` (onboarding + launch all panes)
- `clanker dashboard` (dashboard only; skips onboarding)
- `clanker slave 1` (worker pane)
- `clanker judge` (integration pane)
- `clanker planner` (planner pane)
- `clanker judge 2` (extra judge pane)
- `clanker planner 2` (extra planner pane)
- `clanker relaunch` (restart all agents with resume)
- `clanker relaunch 1` (restart slave 1 with resume)
- `clanker relaunch --fresh planner` (restart planner without resume)

## Dashboard

- Native scrollback (no alt-screen)
- Commands: `/pause`, `/pause planner`, `/pause judge`, `/pause slave`
- Commands: `/resume`, `/resume planner`, `/resume judge`, `/resume slave`
- Commands: `/relaunch [--fresh] [target]`, `/task <id> <status>`, `/focus`
- History: Up/Down to recall commands; last 50 entries persisted to disk
- Slash list: `/` to list and filter, `/help` to list

## End-to-end Flow (manual panes)

### Startup

1. `clanker` (onboarding; creates `clanker.yaml` + `.clanker/` if missing)
2. Accept defaults or edit missing `clanker.yaml` fields (prompted one-by-one)
3. `clanker` launches a 3x2 tmux layout: dashboard + planner + judge + 3 slaves

### Plan + Execute

1. Update `docs/plan-*.md`
2. If `startImmediately` is false: `/resume` in dashboard (injects plan context)
3. Planner emits one task packet per prompt while `queued < backlog`
4. Dashboard assigns queued tasks to slaves
5. Slaves work → set `needs_judge`
6. Judge sets `done`, `rework`, or `blocked` (blocked auto-queues follow-up)

### Pause / Resume

- `/pause`: pauses all Codex CLIs and task generation (one-time)
- `/pause planner`: pauses planner only; gates assignment
- `/pause judge`: pauses judge only
- `/pause slave`: pauses slaves only
- `/resume`: resumes all and injects plan docs
- `/resume planner|judge|slave`: resumes only that role
- Pause action waits for Codex to be in working mode; escalation prompts delay the pause.
- Role resumes do not clear a global `/pause`; use `/resume` to clear global pause.

### Shutdown

1. Stop each pane (Ctrl-C) or `tmux kill-session`
2. State stays in `.clanker/` for later `clanker` run

## Observability

- Primary runtime trace lives in `.clanker/events.log`; keep it for diagnosing agent pathologies.
- Handoffs and summaries in `.clanker/history/`.

## Task Flow

1. Write/update `docs/plan-*.md`
2. `/resume` injects plan context (or rely on `startImmediately: true`)
3. Tasks land in `.clanker/tasks/*.json`
4. Slaves execute → `needs_judge`
5. Judge verifies → `done` or `rework`

## Handoff

- `clanker task handoff <id> slave --summary "..." --tests "..." --diffs "..." --risks "..."`
- `clanker task handoff <id> judge --summary "..." --tests "..." --diffs "..." --risks "..."`

## Agent State Machine (planner / judge / slave)

### Planner

- **Idle**: Codex prompt visible, waiting for input.
- **Plan inject**: dashboard dispatches plan prompt when `queued < backlog` and planner not paused.
- **Planning**: Codex CLI shows `• Working (...) esc to interrupt` while generating tasks.
- **Done**: planner writes one task packet into `.clanker/tasks/*.json`.
- **Loop**: dashboard re-prompts until backlog target is hit.

### Slaves

- **Idle**: no task assigned.
- **Assigned**: dashboard picks a `queued` task, sets `assignedSlaveId`.
- **Prompted**: dashboard injects task prompt once per task (when `promptedAt` is empty).
- **Working**: Codex CLI in reasoning mode (`• Working...`) until user or task completion.
- **Rework**: judge sets task `rework` → `promptedAt` cleared → dashboard re-prompts same slave.
- **Blocked**: judge sets task `blocked` → clanker queues a follow-up task automatically.

### Judge

- **Idle**: no auto prompt today. Judge reviews `needs_judge` tasks.
- **Review**: user reads outputs + runs checks.
- **Decision**: judge updates task via `/task <id> done|rework|blocked` or `clanker task status ...`.

## Handoff Mechanics

- Clanker does **not** parse Codex output. Handoff is **explicit**:
  - `clanker task handoff <id> slave ...` writes `.clanker/history/task-<id>-slave.md`
  - `clanker task handoff <id> judge ...` writes `.clanker/history/task-<id>-judge.md`
  - Status change: `/task <id> <status>` or `clanker task status <id> <status>`

## Health

- `clanker health`
- `clanker doctor --fix`

## Config

See `clanker.yaml` for `slaves`, `backlog`, `tmuxFilter`, `codexCommand`, `promptFile` (testing/automation), `startImmediately`.
`tmuxFilter` is a tmux session filter; leave empty to use `clanker-<repo>`.
`startImmediately` controls initial state: true → auto `/resume`; false → start paused.

## Verify

- `yarn verify` (format + typecheck + unit + integration)
- `yarn test:it` (integration only; stub mode)
- `yarn test:it:real` (runs real Codex; use for behavior changes)
- See `docs/integration-tests.md` for suite details.
