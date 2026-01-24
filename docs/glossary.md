# Clanker Glossary

read_when: onboarding, reference

- **Planner**: LLM that reads plan docs and produces task packets.
- **Slave**: Coder agent that executes a task packet.
- **Judge**: Verifier agent; runs tests + decides mainline.
- **Task Packet**: JSON file in `.clanker/tasks/` with prompt + scope.
- **Handoff**: Structured summary written to `.clanker/history/`.
- **Owner Dir**: Top-level directory lock for conflict avoidance.
- **Owner File**: File-level lock override for hot dirs.
- **Events Log**: `.clanker/events.log` JSONL timeline for tasks + agent activity.
- **Metrics**: `.clanker/metrics.json` rolling stats snapshot.
