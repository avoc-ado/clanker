import type { TaskRecord } from "../state/tasks.js";
import { buildJudgeRelaunchPrompt, selectAssignedTask } from "../commands/relaunch-prompt.js";

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
