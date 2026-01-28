# Clanker Observability

read_when: ops, debugging

## Goals

- Trace task lifecycle and agent behavior over time
- Spot pathological loops (churn, idle, rework storms)
- Correlate tasks, handoffs, events, and agent logs

## Directory Map (.clanker)

- `events.log` (JSONL, append-only)
  - Primary timeline. Each line has ISO timestamp `ts`.
  - References `taskId`, `slaveId`, and optional `data`.
- `state.json`
  - Snapshot of pause state + task statuses.
  - `usageLimit` records the last detected usage-limit pause.
  - No timestamps; use `events.log` for chronology.
- `tasks/*.json`
  - Task packets. No created/updated fields.
  - Use file mtime or `events.log` `TASK_CREATED` for timing.
- `history/task-<id>-{slave|judge}.md`
  - Handoff summaries. File name links to task id.
  - No timestamp inside; use file mtime or events log for order.
- `heartbeat/<id>.json`
  - Per-agent heartbeat with `ts`, `pid`, `role`.
- `metrics.json`
  - Rolling metrics with `updatedAt`, burn/backlog series.
- `logs/<role>-<id>-<iso>.log`
  - Codex/stdout capture per pane.
  - Timestamp is in filename (ISO with `:` and `.` replaced by `-`).
- `locks/*.lock`
  - Task assignment locks.
  - Payload includes `lockedAt` and `pid`.
- `archive/tasks/*.json`
  - Old tasks moved via `clanker task gc` (mtime based).
- `command-history.json`
  - Dashboard command history (latest 50 entries).

## Event Schema (events.log)

Each line is JSON:

```json
{
  "ts": "2026-01-24T12:34:56.789Z",
  "type": "TASK_DONE",
  "msg": "status → done",
  "taskId": "t1",
  "slaveId": "slave-1",
  "data": { "tok": 1234, "cost": 0.12 }
}
```

Key fields:

- `ts`: ISO 8601 timestamp (UTC)
- `type`: event type (`TASK_CREATED`, `TASK_DONE`, `PLAN_SENT`, etc.)
- `msg`: short human-readable summary
- `taskId` / `slaveId`: cross references to task/agent
- `data`: optional metrics payload (token/cost or extra ids)

## Task Packet Cross-References

Fields commonly used for tracing:

- `id`: task id (links to history filenames + events `taskId`)
- `assignedSlaveId`: current worker (links to heartbeat + logs)
- `resumeSlaveId`: preferred worker for rework/follow-up
- `ownerDirs` / `ownerFiles`: lock scoping
- `baseMainSha`: repo snapshot for task context
- `promptedAt`: when dashboard last injected the task prompt
- `usage`: token/cost summary

## Practical Spelunking Flow

1. Start with `events.log` for the timeline.
2. Open the task JSON referenced by `taskId`.
3. Review latest `history/task-<id>-*.md`.
4. If needed, open `logs/<role>-<id>-*.log` for raw output.
5. Check `heartbeat` for stale agents and `metrics.json` for drift.
