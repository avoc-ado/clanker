# Clanker Quickstart

read_when: first-use, onboarding

## Install

- `yarn install`
- `yarn build`

## Start

- `clanker` (dashboard)
- `clanker resume` (unpause + dashboard)
- `clanker slave 1` (worker pane)
- `clanker judge` (integration pane)
- `clanker planner` (planner pane)

## Task Flow

1. Write/update `docs/plan-*.md`
2. Run `clanker plan` to prompt planner
3. Tasks land in `.clanker/tasks/*.json`
4. Slaves execute → `needs_judge`
5. Judge verifies → `done` or `rework`

## Handoff

- `clanker task handoff <id> slave --summary "..." --tests "..." --diffs "..." --risks "..."`
- `clanker task handoff <id> judge --summary "..." --tests "..." --diffs "..." --risks "..."`

## Health

- `clanker health`
- `clanker doctor --fix`

## Config

See `clanker.yaml` for `slaves`, `tmuxFilter`, `codexCommand`, `promptFile` (testing/automation).
`tmuxFilter` is a tmux session filter; leave empty to use `clanker-<repo>`.

## Verify

- `yarn verify` (format + typecheck + unit + integration)
- `yarn test:it` (integration only; stub mode)
- `yarn test:it:real` (runs real Codex; use for behavior changes)
- See `docs/integration-tests.md` for suite details.
