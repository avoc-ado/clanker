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
- Use cursor-agent background for long jobs; tmux only for interactive/persistent (debugger/server).

## Build / Test

- Before handoff: run full gate (lint/typecheck/tests/docs).
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

You are an AI assistance for writing fullstack code with Typescript.

# Project Structure

This is a monorepo with the following structure:

1. backend - the backend server: contains multiple services, shared code, and scripts.
   1. backed/src - the backend server code.
      1. backend/src/generated - the generated code from the relay graphql schema.
      2. backend/src/services - the services folder contains the different services, of which the graphql service is the main one.
      3. backend/src/shared - the shared code folder
      4. backend/src/scripts - the scripts folder
   2. backend/prisma - the prisma folder containing prisma schema and migrations.
   3. backend/tests - the tests folder containing unit tests for the backend.
   4. backend/clickhouse - the clickhouse folder containing the schema for clickhouse tables.
2. mobile - the mobile app: contains the mobile app code.
   1. mobile/app - the mobile app code defining the app structure and pages.
   2. mobile/components - the components folder contains reusable components for the app.
   3. mobile/core - the core folder contains the core code to be used throughout the app.
   4. mobile/env - the env folder contains the environment variables for the mobile app.
   5. mobile/generated - the generated code from the relay graphql schema.
   6. mobile/tamagui - the tamagui folder containing the tamagui configuration, tokens, colors, themes and fonts to be used throughout the app.
3. terraform - the terraform folder containing the terraform code for the infrastructure.
4. site - the folder containing code for the website. This is used as landing page outside the app, for web pages embedded in the app, and for deep linking.
5. proxy - express-based proxy service handling rate limits and request forwarding.
6. lambdas - serverless functions such as `image_cdn`.
7. desktop - Electron desktop application sources.
8. rust - asynchronous Rust services under `src/services`.
9. bin - various helper scripts.
10. secure - cosigner signing utilities and related tooling.

# Interaction Guidelines

- Don’t apologize for errors: fix them
- If you think there might not be a correct answer, you say so. If you do not know the answer, say so instead of guessing.
- You may ask about stack assumptions if writing code
- Comments MUST describe purpose, not effect
- If you can’t finish code, add TODO: comments

# Development Guidelines

MOST IMPORTANT RULE: consider what part of the project you should edit (mobile, backend, etc.), including if the change
includes multiple parts. State that clearly in the beginning of your answer. Don't edit files in the wrong part of the project.

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
export const SHOULD_NOT_WRAP_SOL = Object.values(Dex).filter(
  (dex) => !shouldWrapSol(dex)
);

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

## Syntax and Formatting

- Avoid unnecessary curly braces in conditionals; use concise syntax for simple statements.
- Use declarative JSX.
- Use Prettier for consistent code formatting.
- Prefer `array.at(0)` with optional chaining over checking `!array.length` and
  then indexing `array[0]`.

## Backend-Specific Guidelines

### API Design

- All user-facing APIs should be via the graphql API.
- Always consider the volume of data being sent to the client and being processed on the server. This is a data intensive application.
- Consider edge cases, error handling, and retry logic.
- Use `formatLamportsToSolString` when converting lamport values to SOL strings in any response.
- Telegram bot replies must use named imports from `telegraf/format` (e.g., `import { code, bold, join } from "telegraf/format"`) instead of manual Markdown strings.
  - example: join([fmt`💸 Success!`, fmt``, fmt`🚀 Sending ${formatLamportsToSolString({ lamports })} SOL your way!`], "\n")
- All prisma models should include `createdAt DateTime @default(now())` and `updatedAt DateTime @default(now()) @updatedAt`

### Service Pattern

- Parse command line flags using `yargs` with `hideBin(process.argv)`. Param helpers can be found in yargs_helper.ts.
- Initialize clients (Prisma, Redis, etc.) using `Promise.all` before starting work.
- Run core logic inside `async function main()` or an immediately invoked async function.
- When executed directly, use `if (require.main === module)` and call `main().catch(mainErrHandler)` or `main().catch(cronErrHandler(DDMetric.*SERVICE_NAME*_CRON_ERROR))`.
- Start `HttpHealthz` or other health checks immediately after clients early in `main()`.

### Data Loading

- Use [DataLoader](./dataloader.md) for batching and caching database reads.
- Place all loader code in `backend/src/shared/loaders` with a subdirectory for each model.
- Model subdirectories expose factories like `makeWalletByIdLoader` or `makeWalletByTelegramIdLoader`.
- Collect a model's loaders via `makeWalletLoaders` and export the type describing them.
- Create a root `makeLoaders` function that accepts Prisma clients and returns an object grouping all model loader sets.
- Extend `TradeBotContext` with a `loaders` field whose interface mirrors the object returned by `makeLoaders`.

### UI and Styling

- Use Tamagui for UI components. The latest Tamagui docs are here - https://tamagui.dev/docs/intro/introduction
- In-line styles instead of having them at the bottom of the file.
- Use custom Button.tsx and Text.tsx imported from @/components instead of Tamagui's Button and Text.
- use "$xs, $sm, $md, $lg" instead of hardcoding font sizes.
- Leverage react-native-reanimated and react-native-gesture-handler for performant animations and gestures.

### Components and Relay

- Non-trivial components should be split into its own file.
- If data is fetched from GraphQL, use Relay fragments and propagate the fragments up to the parent component where the query is made.
- Avoid any custom types/interfaces that can be otherwise captured by a fragment.
- fragment/query names in each file must match Relay naming conventions based on pathname.

### Performance Optimization

- Minimize the use of useState and useEffect; prefer context and reducers for state management.
- Implement code splitting and lazy loading for non-critical components with React's Suspense and dynamic imports.
- Profile and monitor performance using React Native's built-in tools and Expo's debugging features.
- Avoid unnecessary re-renders by memoizing components and using useMemo and useCallback hooks appropriately.
- Be sure to use the properties defined in files in tamagui folder, in particular themes.ts, fonts.ts and tokens.ts

### State Management

- Use StorageContext for any persistent state.
- use relay and graphql in generated folder for api calls

### Internationalization (i18n)

- Use i18n-js. See how it's handled in the app.

### Key Conventions

1. Prioritize Mobile Web Vitals (Load Time, Jank, and Responsiveness).

## Local Validation

Run backend checks locally before committing. From the `backend` directory: `yarn check`

- This script runs `lint`, `tsc`, `test`, `testlint`, and Prettier's check mode to mirror CI.
- Failure to `yarn check` due to missing `yarn` command can happen if the command is not run from the `backend` directory.

To fix basic formatting issues automatically, use: `yarn check:fix`

- This only applies Prettier in write mode and does not attempt ESLint or TypeScript fixes.

## AI Development Approach

- Use test-driven development whenever possible. Every change should include or update unit tests proving the behavior of new or refactored code.
- Each change should include testing of the running product using chrome-devtools, mobile simulator, or similar.
- Test mocks should mock using `createTypedMock = <T>(impl: DeepPartial<T>): Mocked<T>; import { createTypedMock } from "../../test-utils/createTypedMock"; `. Do not create a POJO with `as any` or `as unknown` type for mocking if at all possible.
- Tests run concurrently and should not reference mutable file shared variables. Each test should define its own local variables instead.
- Tests can assert response body by accessing text.text using `const res = await processCallback({ ctx: ctx as any, callbackData: data }); t.true(res?.text.text.includes("FlipSol Bot Help!"));`
- Use async versions of node functions over synchronous blocking versions
- Extract shared functions, constants, or interfaces into `backend/src/shared` when appropriate, even if this means refactoring existing code before addressing the prompt directly.
- When working in a `service` directory you may reorganize code into multiple files or subdirectories and add unit tests for the refactorings without further instruction.
- Contibuting a partial design doc, scaffolding, or a single pure function with tests is a successful outcome if the task is vague or broad.
- Favor pure functions and unit-testable modules over monolithic implementations.
- Ensure every pure function is covered by unit tests.
- Do not use global mutable variables to store user state. Prefer encoding session info in telegram callbacks, e.g. `makeTgCallback({ callback: TgCallback.FlipCustomAmount, data: { t: telegramId, a: amount }}). callback data supports strings, null and objects that will be stringified. More complex persistent data can use Prisma.
