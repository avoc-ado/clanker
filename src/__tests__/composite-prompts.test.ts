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
    });
    expect(prompts.dispatchPrompt).toContain("clanker judge");
    expect(prompts.dispatchPrompt).toContain("/tmp/.clanker/tasks/t1.json");
    expect(prompts.dispatchPrompt).toContain("/tmp/.clanker/history/task-t1-slave.md");
  });
});
