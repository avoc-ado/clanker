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
- Remove slow pack IT + cleanup helpers
- Add IT: resume CLI toggles paused + emits RESUMED
- Add IT: task handoff usage persists + emits TASK_USAGE
- Add IT: tail output includes tok/judge formatting for usage events
- Add IT: real mode tmux flow (dashboard + planner + slave)
- Fail fast if tmux/codex missing in real IT mode
- Real IT: full flow runs dashboard + planner + slaves + judge and checks artifact output
- Docs + README use "codex CLI" wording (no alias)
- Default codexCommand to `codex --no-alt-screen --sandbox workspace-write` in config
- Auto-write clanker.yaml with commented defaults on startup
- Add planners/judges config + status/dashboard readout
- Add `--prompt-file` for plan/task dispatch; remove `CLANKER_PROMPT_MODE`
- Stabilize real-flow IT: codex UI ready wait + tmux send-keys literal + window-name fallback
- Replace env overrides with CLI args/config where appropriate (`--codex-command`, `--codex-tty`, `--disable-codex`)
- Deduplicate prompt helpers (e.g. `getPromptMode`) into shared util
- Add `test:it:real:debug` with `--detectOpenHandles`
- Keep tmux session alive before respawn in real IT flow

## Stack Rank

1. Blind-spot audit: map current IT coverage to features; list gaps (low/medium)
2. Add IT: planner/judge rework routing (CLI-level)
3. Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)
4. Add IT: tmux attach (pane discovery + send-keys)
5. Add IT: lock/ownership conflict detection + lock expiry
6. Add flaky guard for tmux-bound scenarios
7. Add example plan doc fixture for integration

## Now

- Blind-spot audit: map current IT coverage to features; list gaps (low/medium)
- Add IT: planner/judge rework routing (CLI-level)
- Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)

## Next

- Add IT: tmux attach (pane discovery + send-keys)
- Add IT: lock/ownership conflict detection + lock expiry
- Add flaky guard for tmux-bound scenarios

## Later

- Add example plan doc fixture for integration
