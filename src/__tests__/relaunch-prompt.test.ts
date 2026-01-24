import type { TaskRecord } from "../state/tasks.js";
import {
  buildJudgeRelaunchPrompt,
  buildRelaunchPromptForJudge,
  buildRelaunchPromptForPlanner,
  buildRelaunchPromptForSlave,
  selectAssignedTask,
} from "../prompting.js";

const makeTask = (overrides: Partial<TaskRecord>): TaskRecord => {
  return {
    id: overrides.id ?? "t1",
    status: overrides.status ?? "queued",
    title: overrides.title,
    assignedSlaveId: overrides.assignedSlaveId,
    resumeSlaveId: overrides.resumeSlaveId,
    prompt: overrides.prompt,
    promptedAt: overrides.promptedAt,
    usage: overrides.usage,
    baseMainSha: overrides.baseMainSha,
    ownerDirs: overrides.ownerDirs,
    ownerFiles: overrides.ownerFiles,
  } satisfies TaskRecord;
};

describe("selectAssignedTask", () => {
  test("prefers running over rework", () => {
    const tasks = [
      makeTask({ id: "b", status: "rework", assignedSlaveId: "c1" }),
      makeTask({ id: "a", status: "running", assignedSlaveId: "c1" }),
    ];
    expect(selectAssignedTask({ tasks, slaveId: "c1" })?.id).toBe("a");
  });

  test("returns null when no active tasks", () => {
    const tasks = [makeTask({ id: "a", status: "queued", assignedSlaveId: "c1" })];
    expect(selectAssignedTask({ tasks, slaveId: "c1" })).toBeNull();
  });

  test("breaks ties by id when statuses match", () => {
    const tasks = [
      makeTask({ id: "b", status: "running", assignedSlaveId: "c1" }),
      makeTask({ id: "a", status: "running", assignedSlaveId: "c1" }),
    ];
    expect(selectAssignedTask({ tasks, slaveId: "c1" })?.id).toBe("a");
  });
});

describe("buildJudgeRelaunchPrompt", () => {
  test("returns null when no needs_judge tasks", () => {
    const tasks = [makeTask({ id: "a", status: "running" })];
    expect(buildJudgeRelaunchPrompt({ tasks })).toBeNull();
  });

  test("lists needs_judge tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "needs_judge", title: "Check auth" }),
      makeTask({ id: "b", status: "needs_judge" }),
    ];
    const prompt = buildJudgeRelaunchPrompt({ tasks });
    expect(prompt).toContain("needs_judge");
    expect(prompt).toContain("- a: Check auth");
    expect(prompt).toContain("- b");
  });
});

describe("buildRelaunchPromptForSlave", () => {
  test("uses file dispatch when promptSettings mode is file", () => {
    const task = makeTask({ id: "t9", status: "running", assignedSlaveId: "c1", prompt: "do it" });
    const prompt = buildRelaunchPromptForSlave({
      promptSettings: {
        mode: "file",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/tmp/plan-prompt.txt",
      },
      task,
    });
    expect(prompt.text).toContain(".clanker/tasks/t9.json");
  });

  test("uses inline prompt when available", () => {
    const task = makeTask({ id: "t3", status: "running", assignedSlaveId: "c1", prompt: "hello" });
    const prompt = buildRelaunchPromptForSlave({
      promptSettings: {
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/tmp/plan-prompt.txt",
      },
      task,
    });
    expect(prompt.text).toBe("hello");
  });
});

describe("buildRelaunchPromptForPlanner", () => {
  test("uses plan prompt path", () => {
    const prompt = buildRelaunchPromptForPlanner({
      promptSettings: {
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/tmp/plan-prompt.txt",
      },
    });
    expect(prompt.text).toContain(".clanker/plan-prompt.txt");
  });
});

describe("buildRelaunchPromptForJudge", () => {
  test("returns null when no judge tasks", () => {
    const prompt = buildRelaunchPromptForJudge({
      tasks: [makeTask({ id: "a", status: "running" })],
    });
    expect(prompt).toBeNull();
  });
});
