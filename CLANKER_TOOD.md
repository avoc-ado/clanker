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

## Now

- (none queued)

## Next

- If codex resolution fails in real IT mode, prompt to install; decline exits nonzero

## Later

- Split integration suite into fast vs extended (tagged)
- Add flaky guard for tmux-bound scenarios
- Add example plan doc fixture for integration
