import type { PromptSettings } from "../prompting.js";
import type { TaskRecord } from "../state/tasks.js";
import {
  buildCompositePrompt,
  buildJudgePrompts,
  buildSlavePrompts,
} from "../prompting/composite-prompts.js";
import { ClankerRole } from "../prompting/role-prompts.js";

const promptPaths = {
  tasksDir: "/tmp/.clanker/tasks",
  historyDir: "/tmp/.clanker/history",
};

const baseTask = {
  id: "t1",
  status: "running",
  prompt: "ship it",
  title: "Improve prompts",
  slaveCommitSha: "abc123",
} satisfies TaskRecord;

const inlineSettings = {
  mode: "inline",
  planPromptPath: ".clanker/plan-prompt.txt",
  planPromptAbsolutePath: "/tmp/.clanker/plan-prompt.txt",
} satisfies PromptSettings;

const fileSettings = {
  ...inlineSettings,
  mode: "file",
} satisfies PromptSettings;

describe("composite prompts", () => {
  test("buildCompositePrompt merges base + body", () => {
    const prompt = buildCompositePrompt({
      role: ClankerRole.Slave,
      body: "ship it",
      paths: promptPaths,
    });
    expect(prompt).toContain("clanker slave");
    expect(prompt).toContain("ship it");
  });

  test("buildSlavePrompts respects inline vs file dispatch", () => {
    const inlinePrompts = buildSlavePrompts({
      task: baseTask,
      paths: promptPaths,
      promptSettings: inlineSettings,
    });
    expect(inlinePrompts.dispatchPrompt).toContain("ship it");
    expect(inlinePrompts.dispatchPrompt).toContain("Task id: t1: Improve prompts");
    expect(inlinePrompts.dispatchPrompt).toContain("commit before needs_judge");
    expect(inlinePrompts.dispatchPrompt).toContain("clanker task status t1");
    expect(inlinePrompts.dispatchPrompt).toContain("clanker task handoff t1 slave");
    expect(inlinePrompts.dispatchPrompt).toContain("clanker task note t1 slave");

    const filePrompts = buildSlavePrompts({
      task: baseTask,
      paths: promptPaths,
      promptSettings: fileSettings,
    });
    expect(filePrompts.dispatchPrompt).toContain("/tmp/.clanker/tasks/t1.json");
    expect(filePrompts.dispatchPrompt).toContain("clanker task status t1");
  });

  test("buildJudgePrompts includes task + handoff paths", () => {
    const prompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "checked_out", commitSha: "abc123" },
    });
    expect(prompts.dispatchPrompt).toContain("clanker judge");
    expect(prompts.dispatchPrompt).toContain("Commit to verify: abc123");
    expect(prompts.dispatchPrompt).toContain("Judge checkout: checked out abc123");
    expect(prompts.dispatchPrompt).toContain("clanker task status t1");
    expect(prompts.dispatchPrompt).toContain("/tmp/.clanker/tasks/t1.json");
    expect(prompts.dispatchPrompt).toContain("/tmp/.clanker/history/task-t1-slave.md");
  });

  test("buildJudgePrompts handles missing commit", () => {
    const prompts = buildJudgePrompts({
      task: { ...baseTask, slaveCommitSha: undefined },
      paths: promptPaths,
    });
    expect(prompts.dispatchPrompt).toContain("Commit to verify: (missing; request rework)");
    expect(prompts.dispatchPrompt).toContain("clanker task status t1 done|rework|blocked|failed");
    expect(prompts.dispatchPrompt).not.toContain("clanker task note t1 judge");
  });

  test("buildJudgePrompts reflects checkout status context", () => {
    const dirtyPrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "dirty", commitSha: "abc123" },
    });
    expect(dirtyPrompts.dispatchPrompt).toContain(
      "Judge checkout: worktree dirty; clean it before checkout",
    );

    const missingLocalPrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "commit_missing_locally", commitSha: "abc123" },
    });
    expect(missingLocalPrompts.dispatchPrompt).toContain(
      "Judge checkout: commit missing locally (abc123)",
    );
  });

  test("buildJudgePrompts maps remaining checkout states", () => {
    const missingCommitPrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "missing_commit", commitSha: "abc123" },
    });
    expect(missingCommitPrompts.dispatchPrompt).toContain(
      "Judge checkout: missing slave commit; request rework",
    );

    const missingWorktreePrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "missing_worktree", commitSha: "abc123" },
    });
    expect(missingWorktreePrompts.dispatchPrompt).toContain(
      "Judge checkout: missing judge worktree",
    );

    const checkoutFailedPrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "checkout_failed", commitSha: "abc123" },
    });
    expect(checkoutFailedPrompts.dispatchPrompt).toContain(
      "Judge checkout: checkout failed; verify manually",
    );

    const skippedPrompts = buildJudgePrompts({
      task: baseTask,
      paths: promptPaths,
      judgeCheckout: { status: "skipped", commitSha: "abc123" },
    });
    expect(skippedPrompts.dispatchPrompt).toContain("Judge checkout: skipped");
  });
});
