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
- `yarn verify` (includes integration tests)

## Notes

- Each test creates its own temp repo with `docs/plan-*.md`.
- Plan docs include a directive: "planner must output a minimum of 2 task packets" to avoid one-shot plans.
- Stub mode uses a small Node script that echoes args to stdout.
- Real mode requires `c` or `codex` on PATH (override with `CLANKER_IT_REAL_COMMAND`). If missing, the runner prompts to install via `npm i -g @openai/codex`.
- Select mode with `CLANKER_IT_MODE=stub|real` (default: stub).
