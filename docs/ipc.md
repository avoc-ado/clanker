# IPC Socket Protocol

read_when: architecture, ops, no-escalation

## Goal

- Allow planner/slave/judge pods in worktrees to coordinate without writing to repo-root `.clanker/`.
- Dashboard owns state + persistence; pods send events via local IPC.

## CLI Behavior

- When `CLANKER_IPC_SOCKET` is set, `clanker task add|status|handoff|note` uses IPC and does not write `.clanker/` directly.
- When unset, CLI falls back to filesystem state as before.

## Transport

- Unix domain socket (local only).
- NDJSON: one JSON object per line.
- Request/response: client sends one line; server replies one line.

## Socket Path

- `CLANKER_IPC_SOCKET=/tmp/clanker-<repo>.sock` (or test-specific path)
- Dashboard creates socket; pods connect on demand.

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

## Message Types

### hello

Announce pod identity + capabilities.

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
- Handler assigns queued work to `podId` when possible and records `TASK_PROMPTED`.

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
    "risks": "..."
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

## Fallback Behavior

- If `CLANKER_IPC_SOCKET` is unset or connect fails:
  - Planner writes task packets to `.clanker/tasks` (via `clanker task add`).
  - Dashboard uses filesystem for assignments.
  - Slave/judge uses filesystem for status/handoff.

## Security

- Socket is local-only; no remote access.
- Dashboard rejects unknown message types.

## Versioning

- `v` is required; server rejects unsupported versions.

```

```
