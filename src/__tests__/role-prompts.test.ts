import {
  buildBasePrompt,
  buildJudgeTaskDispatch,
  buildJudgeRelaunchPrompt,
  buildPlanFileDispatch,
  buildTaskFileDispatch,
  ClankerRole,
  mergePromptSections,
} from "../prompting/role-prompts.js";

describe("role prompts", () => {
  test("planner base prompt includes planner guidance", () => {
    const prompt = buildBasePrompt({
      role: ClankerRole.Planner,
      paths: { tasksDir: "/tmp/.clanker/tasks", historyDir: "/tmp/.clanker/history" },
    });
    expect(prompt).toContain("clanker planner");
    expect(prompt).toContain("one task packet");
  });

  test("slave base prompt includes status + handoff", () => {
    const prompt = buildBasePrompt({
      role: ClankerRole.Slave,
      paths: { tasksDir: "/tmp/.clanker/tasks", historyDir: "/tmp/.clanker/history" },
    });
    expect(prompt).toContain("clanker slave");
    expect(prompt).toContain("clanker task status");
    expect(prompt).toContain("handoff");
  });

  test("judge base prompt includes review + decision", () => {
    const prompt = buildBasePrompt({
      role: ClankerRole.Judge,
      paths: { tasksDir: "/tmp/.clanker/tasks", historyDir: "/tmp/.clanker/history" },
    });
    expect(prompt).toContain("clanker judge");
    expect(prompt).toContain("done|rework|blocked");
  });

  test("buildPlanFileDispatch includes prompt path", () => {
    expect(
      buildPlanFileDispatch({ promptPath: "plan.txt", tasksDir: "/tmp/.clanker/tasks" }),
    ).toContain("plan.txt");
  });

  test("buildTaskFileDispatch includes task path", () => {
    expect(buildTaskFileDispatch({ taskId: "t9", tasksDir: "/tmp/.clanker/tasks" })).toContain(
      "/tmp/.clanker/tasks/t9.json",
    );
  });

  test("buildJudgeTaskDispatch includes paths and title", () => {
    const prompt = buildJudgeTaskDispatch({
      taskId: "t9",
      tasksDir: "/tmp/.clanker/tasks",
      historyDir: "/tmp/.clanker/history",
      title: "Add test",
    });
    expect(prompt).toContain("t9: Add test");
    expect(prompt).toContain("/tmp/.clanker/tasks/t9.json");
    expect(prompt).toContain("/tmp/.clanker/history/task-t9-slave.md");
  });

  test("mergePromptSections dedupes and trims", () => {
    const prompt = mergePromptSections({
      sections: ["Line A\n\nLine B", "Line A\nLine C\n\n", ""],
    });
    expect(prompt).toBe("Line A\n\nLine B\nLine C");
  });

  test("buildJudgeRelaunchPrompt returns null when no needs_judge", () => {
    const prompt = buildJudgeRelaunchPrompt({
      tasks: [{ id: "t1", status: "running" }],
      tasksDir: "/tmp/.clanker/tasks",
    });
    expect(prompt).toBeNull();
  });
});
