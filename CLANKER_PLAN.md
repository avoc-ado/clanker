# Clanker Harness Plan

## Scope

- Node harness; config YAML + state dir; blessed TUI; tmux attach
- Resume on sleep/offline; no background daemon
- Roles: planner / judge / slave

## Resume UX

- On start: load state, show paused tasks + assignments
- Single keystroke `/resume` to continue all prior work
- No auto-run on restart; explicit resume only

## Config + State

- `clanker.yaml` (repo root, settings)
- `.clanker/` (state/events/logs/heartbeat/history/archive)
- Raw chat logs: `.clanker/logs/<role>-<id>-<timestamp>.log`
- Defaults: `slaves: 3`
- Config options: `tmuxSession` (optional), `codexCommand` (optional override), `promptFile` (testing/automation)

## CLI

- `clanker` → controller + TUI
- `clanker slave 1` → run slave `c1`
- `clanker judge` → run judge
- `clanker status` → summary
- `clanker tail` → follow events log
- `clanker doctor` → env/attach/worktree checks
- `clanker doctor --fix` → create missing state dirs
- `clanker resume` → unpause + open TUI
- `clanker task handoff <id> <role> --summary --tests --diffs [--risks]`
- `clanker task gc [--days N]` → archive old task JSON

## tmux attach

- `c1` alias: set pane title `clanker:c1`, run `clanker slave 1`
- Controller: `tmux list-panes -a -F '#{pane_id} #{pane_title}'`
- If `tmuxSession` set, restrict panes to that session
- Attach order: existing panes first, then auto-spawn if `slaves` > panes

## Scheduler

- Adaptive concurrency, hard slave cap; LLM may go lower only
- Inputs: readyCount, phase, conflictRate, integrationBacklog, tokenBurn
- Phases: explore (parallel), execute (medium), integrate (low N)
- Throttle on conflicts; expand on low conflicts + high readyCount

## Task routing

- Default lock: top-level dir ownership
- Optional `ownerFiles[]` for file-level locks (override dir lock)
- Conflict detect: watcher + `git status --porcelain`

## Retries

- Exponential backoff + jitter; cap 30s; infinite retries
- Retriable: offline, 429, 5xx, timeouts
- Out-of-tokens: replan/split, not blind retry
  - Planner splits scope and issues smaller packets

## Resilience

- Atomic writes to `clanker.yaml` + append `events.log`
- Heartbeats per slave; reconcile on wake
- Clean SIGTERM/SIGINT checkpoint
- Shutdown state: mark all tasks `paused` on exit; persist current assignments
- Resume UX: TUI starts in paused mode; single keystroke `/resume` resumes prior state

## Handoff + Failure Modes

- Slave completes task, runs verification, writes summary, marks `needs_judge`
- Judge independently verifies; writes summary + verdict
- No mainline until judge says `done`
- Rework: same task stays unmerged; same slave pauses, resumes work, re-submits
- Follow-up tasks: only after task is accepted/mainlined (post-merge improvements)
- Blocked: task waits; planner may split or re-scope; still unmerged; resume same slave when unblocked
- Handoff fix: missing info → planner regenerates packet → same slave resumes

## Handoff Shape (Role Contract)

- Task spec fields: goal, ownerDirs, inputs, expected outputs, tests to run, done criteria
- Internal routing: `resumeSlaveId` set when rework/handoff_fix/blocked to resume same slave
- Slave output: summary + tests + touched files + open risks + TODOs
- Judge output: verdict + verify steps + regressions + required rework
- Planner output: new tasks only; no manual table edits by user

### Handoff Packet (Sample)

```
# judge handoff

## Summary
Verified task scope; mainline ready.

## Tests
- yarn test

## Diffs
- src/state/tasks.ts
- src/commands/task.ts

## Risks
(none)
```

### Handoff Completeness Checklist

- Goal + non-goals
- Scope: ownerDirs + exclusions
- Inputs: plan refs + required files
- Expected outputs: files/behaviors + done criteria
- Tests: exact commands + success criteria
- Risks/assumptions + open questions

### Judge Acceptance Checklist

- Done criteria met
- Tests run + pass (commands listed)
- No missing TODOs blocking release
- Risks recorded + mitigations noted

### Regression Task Checklist

- Repro steps
- Failing test/log
- Expected fix or hypothesis

### Planner Output Checklist

- ownerDirs + deps defined
- Done criteria + tests specified
- Risk/assumption noted

## Flowchart (Handoffs)

```mermaid
flowchart TD
  A[Plan Docs (dev-authored)] --> B[Planner]
  B --> C[Task Packet]
  C --> D[Slave]
  D --> E[Slave Summary + Tests]
  E --> F[Judge]
  F -->|done| G[Mainline]
  F -->|rework| D
  F -->|blocked| B
  F -->|handoff_fix| B
  G --> H[Follow-up Tasks]
  H --> B
```

## Plan Docs Lifecycle

- Plan docs are authored by the developer; clanker does not generate them
- Plan docs are versioned and updateable; new docs can be added anytime
- Planner reads `docs/` each run; uses latest intent + history to build task packets
- Doc updates can trigger new tasks without rewriting past tasks

## Main Sync

- Planner uses read-only `main` snapshot worktree; fast-forward only
- Slave worktree created at `baseMainSha`
- On task start (no local commits): fast-forward to latest `main`
- After work starts: no rebase by slave unless judge requests
- Judge rebase/merge is the final mainline gate

### baseMainSha (Field Spec)

- `baseMainSha`: commit SHA of `main` used to create the slave worktree
- Set on task creation; stored in `.clanker/tasks/<id>.json`
- Used to detect drift; if behind N commits, planner may revalidate task
- Rework keeps same `baseMainSha` unless task is re-scoped

## Git Sync Policy (When)

- Planner: `git fetch` + `git pull --ff-only` before each planning run
- Slave: `git fetch` at task start; `git pull --ff-only` only if clean
- Judge: `git fetch` before verify; rebase slave branch onto `main` for mainline
- Scope change failure: do not rebase; mark failed and replan

## Worktree Map + Commands

- Planner (read-only main): `git worktree add ../c-planner main`
- Judge (integration): `git worktree add ../c-judge main`
- Slave (per task): `git worktree add ../c<profileNum>-<desk> <baseMainSha>`
- Clean up: `git worktree remove ../c<profileNum>-<desk>`

## Scope Change Rule

- Minor adjustment (tests/edge cases): rework same task
- Scope change (new requirements/dirs/users): mark failed/rescoped, no mainline
- Planner creates follow-up tasks from failure summary

## Task Context Source

- New tasks read latest `main` snapshot
- Rework packets read the slave worktree + judge notes

## Context Lifecycle (Chat)

- New task: start a fresh chat (use `/new` or restart `c`)
- Rework: reuse same chat for continuity
- Context pack always injected; prior chat treated as unreliable
- If reset unavailable, restart `c` process in that pane

## Interaction Policy (Questions + Permissions)

- If slave asks for input, do not escalate to developer by default
- Controller replies with a role reminder + proceed-with-best-effort prompt
- If missing critical info, mark `handoff_fix` and ping planner
- Command permissions: handled by Codex CLI rules (default `~/.codex/rules/default.rules`)
- Clanker only detects Codex escalation prompts and auto-focuses the pane (then auto-focuses back)
- Planner may send non-blocking async clarification request (e.g., Slack) for scope gaps

## Escalation Surfacing (Codex CLI)

- Detect codex prompt lines like "Would you like to run the following command?"
- Emit event + tail line `BLOK | ... | escalation | pane cN`
- Auto-focus codex pane on escalation; show status in TUI
- On resume/deny+prompt completion, auto-focus back to prior pane
- No bells/async pings; keep it quiet
- Always visible in TUI without blocking other panes

### Escalation Transitions (Detection Plan)

- Source: `tmux pipe-pane` logs + `tmux capture-pane` polling
- State machine: `idle → escalation_pending → resolved`
- Enter pending: log line contains "Would you like to run the following command?"
- Pending UI check: poll pane for prompt lines ("Would you like..." + "Press enter to confirm")
- Resolve when prompt lines are no longer visible in last N lines
- On resolve: emit `INFO` event, restore focus to prior pane
- Timeout: if pending > N minutes, emit `BLOK` reminder but stay pending

## TUI Debug Hotkeys

- Hotkey to toggle focus between clanker TUI and last active slave pane

## Context Templates (Enumerated)

- Planner: plan docs + current tasks + recent summaries + repo signals + constraints
- Slave: task spec + context pack + repo paths + guardrails
- Judge: task spec + slave summary + verify checklist + repo state
- Rework: judge verdict + required fixes + failing tests
- Handoff fix: missing fields list + regenerated packet
- Regression: repro steps + failing test/log + expected fix
- Health-check: plan goals + current main behavior + acceptance checklist
- Permission escalation: command request + rationale + risk
- Resume: paused tasks + last known assignments + stale heartbeats

### Context Templates (Drafts)

#### Planner

```
ROLE: planner. Build tasks from plan docs. No user co-edit.
INPUTS: {planDocs} {currentTasks} {recentSummaries} {repoSignals} {constraints}
OUTPUT: tasks with goal, ownerDirs, deps, done criteria, tests, risks.
```

#### Slave

```
ROLE: slave. Execute assigned task. No user questions.
TASK: {taskSpec}
CONTEXT: {contextPack}
GUARDRAILS: no destructive ops; use trash; run tests; log risks.
OUTPUT: summary + tests + touched files + TODOs.
```

#### Judge

```
ROLE: judge. Independent verification. No edits unless rework needed.
TASK: {taskSpec}
SLAVE_SUMMARY: {slaveSummary}
VERIFY: {acceptanceChecklist}
OUTPUT: verdict done/rework + verify steps + regressions.
```

#### Rework

```
ROLE: slave. Rework same task. Address judge notes precisely.
INPUT: {judgeVerdict} {failingTests} {requiredFixes}
OUTPUT: updated summary + re-run tests.
```

#### Handoff Fix

```
ROLE: planner. Regenerate missing handoff fields.
MISSING: {missingFields}
OUTPUT: complete task packet; reassign.
```

#### Regression

```
ROLE: slave. Fix regression.
REPRO: {steps}
FAIL: {testOrLog}
OUTPUT: fix + test proof + summary.
```

#### Health-check

```
ROLE: judge. Validate main matches plan.
PLAN: {planGoals}
OBSERVE: {currentBehavior}
OUTPUT: pass/fail + follow-up tasks.
```

#### Permission Escalation

```
ROLE: system. Request approval for command.
CMD: {command}
RATIONALE: {why}
RISK: {riskLevel}
```

#### Resume

```
ROLE: controller. Present paused state; await /resume.
STATE: {pausedTasks} {assignments} {staleHeartbeats}
```

## Auto-Reply Templates

- Role reminder (slave): "You are a slave. Do not ask the user. Make best assumptions, log risks, run tests, hand off."
- Missing info: "Insufficient task packet. Marking handoff_fix; returning to planner."
- Permission denied: "Command blocked by Codex CLI rules. Request escalation with rationale."

## Mainlining + Conflicts + Regressions

- Mainlining performed by judge (integration phase, low N)
- Flow: judge rebases task worktree onto `main`, resolves conflicts, runs gate
- Conflict policy: fix in same task/worktree; if overlap indicates bad plan, planner re-scopes and reassigns
- If conflicts exceed budget, task goes `rework` or `split`
- Regression detection: local gate failures or local tests create auto regression tasks
- Regression tasks: tagged `regression`, highest priority, assigned immediately
- Periodic health-check task: verify `main` app behavior matches current plan/state

## Data Flow + Context (Theory of Mind)

- Source of intent: plan docs in `docs/plan-*.md`
- State of work: `.clanker/state.json` + `.clanker/tasks/*.json`
- Memory: `.clanker/history/*.md` (summaries) + `.clanker/events.log` + `.clanker/logs/*.log`
- Controller keeps in-memory index; persists on every event

### Planner loop

- Inputs: plan docs (`docs/`) + current tasks + recent summaries + local repo signals
- Output: new task packets + ownership + deps in `.clanker/tasks/`
- Context pack: bounded bundle built per run (size cap + relevance filter)
- Planner brief: "LLM creates task packets from plan docs; no manual task tables"

### Slave loop

- Inputs: assigned task + context pack + relevant files
- Output: code changes + summary + test results
- Summary written to `.clanker/history/task-<id>-slave.md`
- Status to `.clanker/tasks/<id>.json` → `needs_judge`

### Judge loop

- Inputs: task + slave summary + context pack + current repo state
- Output: verdict + independent test/verify
- Summary to `.clanker/history/task-<id>-judge.md`
- Status to `.clanker/tasks/<id>.json` → `done` or `rework`

### Update propagation

- Any status change → event log append + state update
- Planner reads latest state + summaries each cycle
- Slaves/judge get fresh context packs on (re)assignment

## Planner Inputs (Capped)

- Inputs: plan docs (`docs/`) + current tasks + recent history summaries
- Cap growth: rolling window + compaction
- Strategy: keep last N task summaries + weekly rollups; prune by recency + relevance
- Build a bounded "context pack" per planning run (size limit)

## History Summaries (What to note)

- Outcome + files touched + commands run
- Decisions/assumptions + rationale
- Errors + fixes + known hazards
- TODOs + follow-ups
- Test results + missing tests

## Feedback Ingestion + Tuning

- Inputs: `.clanker/events.log`, `.clanker/history/*.md`, task state JSON, local test logs
- Store: `.clanker/metrics.json` (rollups: latency, cost, conflict rate, rework rate)
- Actionable signals: high rework, high conflict, high idle, high token burn, low pass rate
- Use: planner prompt tweaks + scheduler tuning + task sizing rules

## Verification (Agent Commitment)

- For the coding agent: add these checks to the testing toolkit
- Run `clanker` TUI + `c1..c3` in tmux; confirm attach + tail stream
- Simulate sleep/offline; ensure paused state + `/resume` works
- Exercise worktree flow: task → slave → judge → mainline mock
- Trigger rework + handoff_fix; ensure same slave resumes
- Validate permission gating + escalation

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
