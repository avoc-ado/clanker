# IPC Socket Protocol

read_when: architecture, ops, no-escalation

## Goal

- Allow planner/slave/judge pods in worktrees to coordinate without writing to repo-root `.clanker/`.
- Dashboard owns state + persistence; pods send events via local IPC.

## CLI Behavior

- When `CLANKER_IPC_SOCKET` is set, `clanker task add|status|handoff|note` uses IPC and does not write `.clanker/` directly.
- When unset (or IPC fails), CLI falls back to filesystem state as before.

## Transport

- Unix domain socket (local only).
- NDJSON: one JSON object per line.
- Request/response: client sends one line; server replies one line.

## Socket Path

- `CLANKER_IPC_SOCKET` is set by `clanker launch` (default: `<repo>/.clanker/ipc.sock`).
- Dashboard creates the socket; pods connect on demand.

## Message Envelope

```json
{ "v": 1, "id": "req-123", "type": "hello", "payload": { ... } }
```

Response:

```json
{ "v": 1, "id": "req-123", "ok": true, "data": { ... } }
```

Errors:

```json
{ "v": 1, "id": "req-123", "ok": false, "error": "reason" }
```

## Message Types (Shipped)

### hello

Announce pod identity + capabilities (no-op beyond ack).

```json
{ "type": "hello", "payload": { "podId": "slave-1", "role": "slave", "worktree": "/path" } }
```

### heartbeat

```json
{ "type": "heartbeat", "payload": { "podId": "slave-1", "pid": 123, "ts": "2026-01-26T..." } }
```

### task_create (planner -> dashboard)

Create task packet (queued).

```json
{
  "type": "task_create",
  "payload": { "task": { "id": "t1", "title": "...", "prompt": "...", "status": "queued" } }
}
```

### task_request (slave -> dashboard)

Request a task assignment.

```json
{ "type": "task_request", "payload": { "podId": "slave-1" } }
```

Response:

```json
{ "ok": true, "data": { "taskId": "t1", "status": "running", "prompt": "base + task prompt" } }
```

- When no work is available: `{ "ok": true, "data": { "taskId": null } }`
- Handler assigns queued work to `podId` when possible, sets `promptedAt`, and records `TASK_PROMPTED`.
- If the task was already prompted, response omits `prompt` and returns `{ taskId, status }`.

### task_status (slave/judge -> dashboard)

```json
{ "type": "task_status", "payload": { "taskId": "t1", "status": "needs_judge" } }
```

### task_handoff (slave/judge -> dashboard)

```json
{
  "type": "task_handoff",
  "payload": {
    "taskId": "t1",
    "role": "slave",
    "summary": "...",
    "tests": "...",
    "diffs": "...",
    "risks": "...",
    "usage": { "tokens": 12, "cost": 3, "judgeTokens": 1, "judgeCost": 1 }
  }
}
```

### task_note (slave/judge -> dashboard)

```json
{
  "type": "task_note",
  "payload": {
    "taskId": "t1",
    "role": "slave",
    "content": "note",
    "usage": { "tokens": 1 }
  }
}
```

### judge_request (judge -> dashboard)

Request next `needs_judge` task.

```json
{ "type": "judge_request", "payload": { "podId": "judge-1" } }
```

Response:

```json
{ "ok": true, "data": { "taskId": "t1", "status": "needs_judge", "prompt": "base + judge prompt" } }
```

- When no `needs_judge` tasks exist: `{ "ok": true, "data": { "taskId": null } }`
- Judge prompts are throttled by `judgePromptedAt`; stale or invalid timestamps re-issue prompts.

### usage_limit (pod -> dashboard)

Report a Codex usage-limit message to pause and recover the fleet.

```json
{
  "type": "usage_limit",
  "payload": {
    "podId": "slave-1",
    "role": "slave",
    "message": "You've hit your usage limit.",
    "ts": "..."
  }
}
```

- Dashboard pauses all panes, polls `/status`, and resumes when the limit clears.

## Fallback Behavior

- If `CLANKER_IPC_SOCKET` is unset or connect fails:
  - Planner writes task packets to `.clanker/tasks` (via `clanker task add`).
  - Dashboard uses filesystem for assignments.
  - Slave/judge uses filesystem for status/handoff.

## Spool (IPC Down)

- When IPC is configured but unreachable, task operations can be spooled to
  `.clanker/ipc-spool.ndjson` for the dashboard to drain on startup/tick.
- Spool is bounded (max 1 MB); oldest entries are trimmed when over limit.

## Security

- Socket is local-only; no remote access.
- Dashboard rejects unknown message types.

## Versioning

- `v` is required; server rejects unsupported versions.

```

```
