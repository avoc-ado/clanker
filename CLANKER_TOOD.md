# Clanker TODO

## Done

- Decide Prettier in verify (`prettier --write` in `yarn verify`, keep `yarn format` check)
- Integration suite shape (parallel-safe tmpdir, no shared ports/state)
- CLI artifact validation uses args/STDIO (no disk writes)
- Plan docs require minimum of 2 task packets (no upper cap)
- Replace `scripts/it-runner.mjs` with TS integration tests
- Add `jest.it.config.cjs` + `tsconfig.it.json`
- Add integration tests under `tests/it`
- Add `yarn test:it` and `yarn verify`
- Update `AGENTS.md` to require `yarn verify`
- Add `docs/integration-tests.md` + quickstart link
- Integration tests support stub + real Codex modes
- Package metadata + README/LICENSE for `npx clanker@latest`
- Real IT mode runs real Codex (interactive + token output), no "extended" mode
- Update IT harness to drive real Codex: send prompt, await output, assert logs non-empty
- Adjust `tests/it/basic-flow.test.ts` to branch stub vs real behavior
- Add IT: pack workspace and run CLI from extracted tarball
- Add IT: resume CLI toggles paused + emits RESUMED
- Add IT: task handoff usage persists + emits TASK_USAGE
- Add IT: tail output includes tok/judge formatting for usage events

## Now

- (none queued)

## Next

- If codex resolution fails in real IT mode, prompt to install; decline exits nonzero
- Blind-spot audit: map current IT coverage to features; list gaps (low/medium)
- Add IT: planner/judge rework routing (CLI-level)
- Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)

## Later

- Add IT: tmux attach (pane discovery + send-keys)
- Add IT: lock/ownership conflict detection + lock expiry
- Add flaky guard for tmux-bound scenarios
- Add example plan doc fixture for integration
