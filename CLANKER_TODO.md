# Clanker TODO

## Done

- IPC: route dispatch/assignment through IPC broker (dashboard), not file polling.
- Refactor: add IPC-first gateway (`task-gateway.ts`) used across CLI + handlers; remove duplicated fs logic.
- IPC perf: avoid repeated 5s timeouts when dashboard absent (socket-exists check or short-lived down cache).
- IPC reliability: replace env knobs with code constants (no dead envvars). Add grace/retry/spool constants + bounded GC; set spool max bytes = 1 MB.
- Docs: align `docs/ipc.md` with implemented message types; mark planned vs shipped.
- When clanker starts, it can fail if no origin/main is configured. Print a prettier helper message after the git error.
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
- Add IT: rework routing + failed status transitions
- Add IT: multi-slave scheduler assignment + stale heartbeat handling (no tmux)
- Add IT: tmux attach (pane discovery + send-keys)
- Add IT: lock/ownership conflict detection (ownerDirs + ownerFiles)
- Define lock expiry policy + tests (stale heartbeat unlocks)
- Add flaky guard for tmux-bound scenarios
- Add example plan doc fixture for integration
- Docs + README use "codex CLI" wording (no alias)
- Default codexCommand to `codex --no-alt-screen --sandbox workspace-write` in config
- Auto-write clanker.yaml with commented defaults on startup
- Add planners/judges config + status/dashboard readout
- Add `--prompt-file` for plan/task dispatch; remove `CLANKER_PROMPT_MODE`
- Stabilize real-flow IT: codex UI ready wait + tmux send-keys literal + window-name fallback
- Replace env overrides with CLI args/config where appropriate (`--codex-command`, `--codex-tty`, `--disable-codex`)
- Deduplicate prompt helpers (e.g. `getPromptMode`) into shared util
- Keep tmux session alive before respawn in real IT flow
- Real IT: planner auto-dispatch waits for Codex prompt readiness; `yarn test:it:real` passes
- IPC: add `task_request` + `judge_request` handlers; shared composite prompt builders
- Tests: add IT coverage for worktree pods updating root state via IPC; ensure no immediate prompts on `/resume`.

## Stack Rank

1. Usage limit handling: detect Codex "You've hit your usage limit" message in production, pause + poll `/status` until reset, then resume (IT real should still fail fast).

## Now

- When launching clanker for the first time, after onboarding, .clanker/worktree dirs are created for the 5 default roles (3 slaves, etc). Then clanker fails with the message

```
command failed: Command failed: tmux set-hook -t clanker-airline-protocol client-detached if -F \"#{==:#{session_name},clanker-airline-protocol}\" { run-shell \"tmux list-clients -t clanker-airline-protocol: 2>/dev/null | wc -l | grep -q '^0$' && tmux kill-session -t clanker-airline-protocol:\" }
syntax error

Error: Command failed: tmux set-hook -t clanker-airline-protocol client-detached if -F \"#{==:#{session_name},clanker-airline-protocol}\" { run-shell \"tmux list-clients -t clanker-airline-protocol: 2>/dev/null | wc -l | grep -q '^0$' && tmux kill-session -t clanker-airline-protocol:\" }
syntax error

    at genericNodeError (node:internal/errors:998:15)
    at wrappedFn (node:internal/errors:543:14)
    at ChildProcess.exithandler (node:child_process:417:12)
    at ChildProcess.emit (node:events:508:28)
    at maybeClose (node:internal/child_process:1085:16)
    at Socket.<anonymous> (node:internal/child_process:456:11)
    at Socket.emit (node:events:508:28)
    at Pipe.<anonymous> (node:net:346:12)
```

- Switch to yargs for args parsing everywhere (CLI + dashboard commands).
- Usage limit handling: detect Codex "You've hit your usage limit" message in production, pause + poll `/status` until reset, then resume (IT real should still fail fast).

## Blind-Spot Audit (List)

- Map current IT coverage to features; list gaps (low/medium).

## Blind-Spot Audit

### Covered

- Plan prompt generation (plan/task file dispatch)
- Task lifecycle basics (add, status, handoff, resume)
- Tail usage formatting (tok/cost/judge)
- CLI artifact creation (stub mode)
- Real flow: dashboard + planner + slave + judge with codex CLI

### Gaps (low/medium)

- Escalation auto-focus + restore behavior in IT
- Resume-after-sleep / offline recovery (paused state consistency)
- Usage-limit recovery in production (pause + resume after reset)
