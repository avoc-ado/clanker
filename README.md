# clanker

Glitchcore agent harness: planner + slaves + judge + TUI dashboard.

## Quickstart

```bash
npx clanker-cli@latest --help
```

```bash
# dashboard
npx clanker-cli@latest

# planner/slave/judge in tmux panes
npx clanker-cli@latest planner
npx clanker-cli@latest slave 1
npx clanker-cli@latest judge
```

## Config

Create `clanker.yaml` at repo root:

```yaml
planners: 1
judges: 1
slaves: 3
tmuxSession: "clanker-swarm"
codexCommand: "codex --no-alt-screen --sandbox workspace-write"
promptFile: ""
```

## Integration tests

```bash
yarn test:it
yarn test:it:stub
yarn test:it:real
yarn test:it:real:debug
```

Real mode needs codex CLI on PATH (override via `CLANKER_IT_REAL_COMMAND`).

## Docs

See `docs/quickstart.md` and `docs/integration-tests.md`.
