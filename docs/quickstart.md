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
1) Write/update `docs/plan-*.md`
2) Run `clanker plan` to prompt planner
3) Tasks land in `.clanker/tasks/*.json`
4) Slaves execute → `needs_judge`
5) Judge verifies → `done` or `rework`

## Handoff
- `clanker task handoff <id> slave --summary "..." --tests "..." --diffs "..." --risks "..."`
- `clanker task handoff <id> judge --summary "..." --tests "..." --diffs "..." --risks "..."`

## Health
- `clanker health`
- `clanker doctor --fix`

## Config
See `clanker.yaml` for `slaves`, `tmuxSession`, `codexCommand`.
