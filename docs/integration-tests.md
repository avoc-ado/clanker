# Integration Tests

read_when: testing, ops

## Goals

- Exercise planner prompt generation, task lifecycle, and logging
- Validate STDIO behavior via stubbed `codexCommand`
- Run in parallel safely (unique tmpdir per test)

## Run

- `yarn test:it`
- `yarn test:it:stub`
- `yarn test:it:real`
- `yarn test:it:real:debug` (adds `--detectOpenHandles` + verbose tmux logging)
- `yarn verify` (includes integration tests)

## Notes

- Each test creates its own temp repo with `docs/plan-*.md`.
- Plan docs include a directive: "planner must output a minimum of 2 task packets" to avoid one-shot plans.
- Stub mode uses a small Node script that echoes args to stdout.
- Real mode runs the codex CLI (generates tokens, may spend usage). It uses real tmux panes and real agent prompts; run it when behavior changes need real agent coverage.
- Real mode runs a tmux-backed flow (dashboard + planner + slave). If tmux is missing it fails fast (`brew install tmux`).
- Real mode requires codex CLI on PATH (override with `CLANKER_IT_REAL_COMMAND`). If missing it fails fast (`npm i -g @openai/codex`).
- Select mode with `CLANKER_IT_MODE=stub|real` (default: stub). `yarn test:it` runs stub only.
- Real mode can use `--prompt-file .clanker/plan-prompt.txt` (or config `promptFile`) to dispatch short prompts that reference plan/task files.
