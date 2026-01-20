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
  F -->|handoff_fix| B
  F -->|blocked| B
  G --> H[Follow-up Tasks]
  H --> B
```

## Signals

- `needs_judge`: slave complete
- `rework`: return to same slave
- `handoff_fix`: planner regenerates packet
- `blocked`: wait for input
