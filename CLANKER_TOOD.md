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

## Stack Rank

1. Replace env overrides with CLI args/config where appropriate (`--codex-command`, `--codex-tty`, `--disable-codex`) and delete env paths
2. Add `--prompt-file` plumbing (plan + dashboard) + config, remove `CLANKER_PROMPT_MODE`
3. Deduplicate prompt helpers (e.g. `getPromptMode`) into shared util
4. Decide `--detectOpenHandles` default vs `test:it:real:debug` script
5. Investigate Jest open-handle warning after `yarn test:it:real`
6. Blind-spot audit: map current IT coverage to features; list gaps (low/medium)
7. Add IT: planner/judge rework routing (CLI-level)
8. Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)
9. Add IT: tmux attach (pane discovery + send-keys)
10. Add IT: lock/ownership conflict detection + lock expiry
11. Add flaky guard for tmux-bound scenarios
12. Add example plan doc fixture for integration

## Now

- Replace env overrides with CLI args/config where appropriate (`--codex-command`, `--codex-tty`, `--disable-codex`)
- Decide `--detectOpenHandles` default vs `test:it:real:debug` script
- Investigate Jest open-handle warning after `yarn test:it:real`
 - Deduplicate prompt helpers (e.g. `getPromptMode`)

## Next

- Blind-spot audit: map current IT coverage to features; list gaps (low/medium)
- Add IT: planner/judge rework routing (CLI-level)
- Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)

## Later

- Add IT: tmux attach (pane discovery + send-keys)
- Add IT: lock/ownership conflict detection + lock expiry
- Add flaky guard for tmux-bound scenarios
- Add example plan doc fixture for integration
