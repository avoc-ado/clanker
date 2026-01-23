# clanker

Glitchcore agent harness: planner + slaves + judge + dashboard stream.

## Quickstart

```bash
npx clanker-cli@latest --help
```

```bash
# dashboard
npx clanker-cli@latest dashboard

# planner/slave/judge in tmux panes
npx clanker-cli@latest planner
npx clanker-cli@latest slave 1
npx clanker-cli@latest judge

# full tmux layout + onboarding
npx clanker-cli@latest
```

## Config

Create `clanker.yaml` at repo root (use `default` to track latest defaults):

```yaml
planners: default
judges: default
slaves: default
backlog: default
startImmediately: default
tmuxFilter: default
codexCommand: default
promptFile: default
```

`tmuxFilter` is a tmux session filter. Leave it empty to use `clanker-<repo>`.

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
