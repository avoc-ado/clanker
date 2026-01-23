# Clanker Workflow

read_when: planning, operations

```mermaid
flowchart TD
  A[Plan Docs] --> B[Planner]
  B --> C[Task Packet]
  C --> D[Slave]
  D --> E[Slave Handoff]
  E --> F[Judge]
  F -->|done| G[Mainline]
  F -->|rework| D
  F -->|blocked| H
  F -->|failed| H
  G --> H[Follow-up Tasks]
  H --> C
```

## Signals

- `needs_judge`: slave complete
- `rework`: return to same slave
- `blocked`: clanker auto-queues a follow-up task
- `failed`: task rejected; planner may split follow-up
