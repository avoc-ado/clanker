# AGENTS.MD

Avo owns this. Start: say hi + 1 motivating line.
Work style: telegraph; noun-phrases ok; drop grammar; min tokens.

## Agent Protocol

- Workspace: `~/repos`.
- 3rd-party/OSS (non-Avo): clone under `~/repos/OSS`.
- PRs: use `gh pr view/diff` (no URLs).
- “Make a note” => edit AGENTS.md (shortcut; not a blocker). Ignore `CLAUDE.md`.
- No `./runner`. Guardrails: use `trash` for deletes.
- Need upstream file: stage in `/tmp/`, then cherry-pick; never overwrite tracked.
- Bugs: add regression test when it fits.
- Keep files <~500 LOC; split/refactor as needed.
- Commits: Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- Subagents: read `docs/subagent.md`.
- Editor: `code <path>`.
- CI: `gh run list/view` (rerun/fix til green).
- Prefer end-to-end verify; if blocked, say what’s missing.
- New deps: quick health check (recent releases/commits, adoption).
- Web: search early; quote exact errors; prefer 2024–2025 sources; fallback Firecrawl (`pnpm mcp:*`) / `mcporter`.
- Oracle: run `npx -y @steipete/oracle --help` once/session before first use.
- Style: telegraph. Drop filler/grammar. Min tokens (global AGENTS + replies).

## Screenshots (“use a screenshot”)

- Pick newest PNG in `~/Desktop` or `~/Downloads`.
- Verify it’s the right UI (ignore filename).
- Size: `sips -g pixelWidth -g pixelHeight <file>` (prefer 2×).
- Optimize: `imageoptim <file>` (install: `brew install imageoptim-cli`).
- Replace asset; keep dimensions; commit; run gate; verify CI.

## Docs

- Start: run docs list (`docs:list` script, or `bin/docs-list` here if present; ignore if not installed); open docs before coding.
- Follow links until domain makes sense; honor `Read when` hints.
- Keep notes short; update docs when behavior/API changes (no ship w/o docs).
- Add `read_when` hints on cross-cutting docs.
- Model note (2025-11-23): no `gpt-5.1-pro` / `grok-4.1` on Peter’s keys yet.
- Model preference: latest only. OK: Anthropic Opus 4.5 / Sonnet 4.5 (Sonnet 3.5 = old; avoid), OpenAI GPT-5.2, xAI Grok-4.1 Fast, Google Gemini 3 Flash.

## PR Feedback

- Active PR: `gh pr view --json number,title,url --jq '"PR #\\(.number): \\(.title)\\n\\(.url)"'`.
- PR comments: `gh pr view …` + `gh api …/comments --paginate`.
- Replies: cite fix + file/line; resolve threads only after fix lands.

## Flow & Runtime

- Use repo’s package manager/runtime; no swaps w/o approval.
- Use Codex background for long jobs; tmux only for interactive/persistent (debugger/server).

## Build / Test

- Before handoff: run full gate (lint/typecheck/tests/docs).
- Always run `yarn verify` after code changes; report results.
- All changes: run `yarn verify`.
- `yarn test:it:real`: agent discretion after changes relevant to integration/real Codex flow.
- All failures: diagnose root cause + note it.
- Behavioral changes: run swarm verify (local), note if blocked by tmux permissions.
- If tmux fails with "Operation not permitted", report in chat and stop (do not work around).
- Add/extend integration tests when behavior spans planner/slave/judge flow; prefer fast tmpdir harness + stub `codexCommand`.
- CI red: `gh run list/view`, rerun, fix, push, repeat til green.
- Keep it observable (logs, panes, tails, MCP/browser tools).
- Release: read `docs/RELEASING.md` (or find best checklist if missing).

## Git

- Safe by default: `git status/diff/log`. Push only when user asks.
- `git checkout` ok for PR review / explicit request.
- Branch changes require user consent.
- Destructive ops forbidden unless explicit (`reset --hard`, `clean`, `restore`, `rm`, …).
- Remotes under `~/Projects`: prefer HTTPS; flip SSH->HTTPS before pull/push.
- Don’t delete/rename unexpected stuff; stop + ask.
- No repo-wide S/R scripts; keep edits small/reviewable.
- Avoid manual `git stash`; if Git auto-stashes during pull/rebase, that’s fine (hint, not hard guardrail).
- If user types a command (“pull and push”), that’s consent for that command.
- No amend unless asked.
- Big review: `git --no-pager diff --color=never`.
- Multi-agent: check `git status/diff` before edits; ship small commits.

## Critical Thinking

- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
- Leave breadcrumb notes in thread.

## Tools

Read `~/Projects/agent-scripts/tools.md` for the full tool catalog if it exists.

### committer

- Commit helper (PATH). Stages only listed paths; required here. Repo may also ship `./scripts/committer`.

### trash

- Move files to Trash: `trash …` (system command).

### Chrome DevTools (MCP)

- Use `mcp__chrome-devtools__*` tools: `new_page`, `navigate_page`, `take_snapshot`, `click`, `fill`, `take_screenshot`, `list_pages`, `select_page`.

### lldb

- Use `lldb` inside tmux to debug native apps; attach to the running app to inspect state.

### oracle

- Bundle prompt+files for 2nd model. Use when stuck/buggy/review.
- Run `npx -y @steipete/oracle --help` once/session (before first use).

### mcporter / iterm / firecrawl / XcodeBuildMCP

- MCP launcher: `npx mcporter <server>` (see `npx mcporter --help`). Common: `iterm`, `firecrawl`, `XcodeBuildMCP`.

### gh

- GitHub CLI for PRs/CI/releases. Given issue/PR URL (or `/pull/5`): use `gh`, not web search.
- Examples: `gh issue view <url> --comments -R owner/repo`, `gh pr view <url> --comments --files -R owner/repo`.

### tmux

- Use only when you need persistence/interaction (debugger/server).
- Quick refs: `tmux new -d -s codex-shell`, `tmux attach -t codex-shell`, `tmux list-sessions`, `tmux kill-session -t codex-shell`.

<frontend_aesthetics>
Avoid “AI slop” UI. Be opinionated + distinctive.

Do:

- Typography: pick a real font; avoid Inter/Roboto/Arial/system defaults.
- Theme: commit to a palette; use CSS vars; bold accents > timid gradients.
- Motion: 1–2 high-impact moments (staggered reveal beats random micro-anim).
- Background: add depth (gradients/patterns), not flat default.

Avoid: purple-on-white clichés, generic component grids, predictable layouts.
</frontend_aesthetics>

AGENTS.md originally from https://raw.githubusercontent.com/steipete/agent-scripts/refs/heads/main/AGENTS.MD

# Interaction Guidelines

- Don’t apologize for errors: fix them
- If you think there might not be a correct answer, you say so. If you do not know the answer, say so instead of guessing.
- You may ask about stack assumptions if writing code
- Comments MUST describe purpose, not effect
- If you can’t finish code, add TODO: comments

## Code Style and Structure

- Write concise, technical TypeScript code with accurate examples.
- Use functional and declarative programming patterns; avoid classes.
- Prefer iteration and modularization over code duplication.
- Prioritize modularity, DRY, performance, and security
- Comments MUST describe purpose, not effect
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError).
- Avoid using new libraries when an alternative is already available in the project.
- Backend and service modules accept clients (Redis, Prisma, etc.) as named parameters so logic stays testable and explicit.
- Seperate reading and writing to prisma with readerPrisma and writerPrisma clients. Unless in an sql transaction, use readerPrisma to read.
- When a function accepts multiple clients as named parameters, list them first with `readerPrisma` before `writerPrisma`, followed by `redis`, `connection`, or other clients. Place secrets next and keep data parameters last.
- Load environment variables and secrets via `getParam(SharedResourceName.*)` instead of directly using `process.env`. Add new names in `backend/src/shared/constants.ts`.

## Naming Conventions

- Use lowercase with dashes for directories (e.g., components/auth-wizard).
- Favor named exports for components.
- Factory functions creating side-effect free objects should use the `make` prefix (e.g., `makeProfileLoader`, `makePrismaClient`).

## TypeScript Usage

- Use TypeScript for all code; prefer interfaces over types.
- Use functional components with TypeScript interfaces.
- Use strict mode in TypeScript for better type safety.
- Use this function definition: const foo = () => {}.
- Use named parameters in all functions. Even for functions with one parameter. e.g. const foo = ({ bar }: { bar: number }) => console.log(bar)
- Use double quotes "" over single quotes. Use string interpolation quotes ``.
- Use satisfies where possible for strictest type checking. Prefer `const wallet = { address: Address() } satisfies Wallet;` over `const wallet: Wallet = { address: Address() };`
- Use named exports. Do not use default exports.
- Do not import and re-export items exported from other files.

## Enum Usage

Use exhaustive switches with `default: const _exhaustiveCheck: never = anEnum;`. Collect switch outputs to arrays `Object.values(Dex).filter(shouldWrapSol)`. use `anArray.includes()` instead of if-expression chaining. Example

```typescript
export enum Dex {
  PumpFun = "pumpfun",
  Raydium = "raydium",
  Moonshot = "moonshot",
}

export function shouldWrapSol(dex: Dex): boolean {
  switch (dex) {
    case Dex.PumpFun:
    case Dex.Raydium:
      return true;
    case Dex.Moonshot:
      return false;
    default:
      const _exhaustiveCheck: never = dex;
      return false;
  }
}

export const SHOULD_WRAP_SOL = Object.values(Dex).filter(shouldWrapSol);
export const SHOULD_NOT_WRAP_SOL = Object.values(Dex).filter((dex) => !shouldWrapSol(dex));

export const handleWrap = ({
  dex,
  instructions,
}: {
  dex: Dex;
  instructions: TransactionInstruction[];
}): boolean => {
  if (!SHOULD_WRAP_SOL.includes(dex)) {
    return instructions;
  }
  return doWrap(instructions);
};
```

## AI Development Approach

- Use test-driven development whenever possible. Every change should include or update unit tests proving the behavior of new or refactored code.
- Each change should include testing of the running product using chrome-devtools, mobile simulator, tmux, or similar for the task at hand.
- Test mocks should mock using `createTypedMock = <T>(impl: DeepPartial<T>): Mocked<T>; import { createTypedMock } from "../../test-utils/createTypedMock"; `. Do not create a POJO with `as any` or `as unknown` type for mocking if at all possible.
- Tests run concurrently and should not reference mutable file shared variables. Each test should define its own local variables instead.
- Use async versions of node functions over synchronous blocking versions
- You may reorganize code into multiple files or subdirectories and add unit tests for the refactorings without prior instruction.
- Favor pure functions and unit-testable modules over monolithic implementations.
- Ensure every pure function is covered by unit tests.
