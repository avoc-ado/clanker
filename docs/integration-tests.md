# Integration Tests

read_when: testing, ops

## Goals

- Exercise planner prompt generation, task lifecycle, and logging
- Validate STDIO behavior via stubbed `codexCommand`
- Run in parallel safely (unique tmpdir per test)

## Run

- `yarn test:it`
- `yarn verify` (includes integration tests)

## Notes

- Each test creates its own temp repo with `docs/plan-*.md`.
- Plan docs include a directive: "planner must output at least 2 task packets" to avoid one-shot plans.
- `codexCommand` is stubbed with a small Node script that echoes args to stdout.
