import {
  buildBasePrompt,
  buildJudgeRelaunchPrompt,
  buildPlanFileDispatch,
  buildTaskFileDispatch,
  ClankerRole,
} from "../prompting/role-prompts.js";

describe("role prompts", () => {
  test("planner base prompt includes planner guidance", () => {
    const prompt = buildBasePrompt({ role: ClankerRole.Planner });
    expect(prompt).toContain("clanker planner");
    expect(prompt).toContain("one task packet");
  });

  test("slave base prompt includes status + handoff", () => {
    const prompt = buildBasePrompt({ role: ClankerRole.Slave });
    expect(prompt).toContain("clanker slave");
    expect(prompt).toContain("clanker task status");
    expect(prompt).toContain("handoff");
  });

  test("judge base prompt includes review + decision", () => {
    const prompt = buildBasePrompt({ role: ClankerRole.Judge });
    expect(prompt).toContain("clanker judge");
    expect(prompt).toContain("done|rework|blocked");
  });

  test("buildPlanFileDispatch includes prompt path", () => {
    expect(buildPlanFileDispatch({ promptPath: "plan.txt" })).toContain("plan.txt");
  });

  test("buildTaskFileDispatch includes task path", () => {
    expect(buildTaskFileDispatch({ taskId: "t9" })).toContain(".clanker/tasks/t9.json");
  });

  test("buildJudgeRelaunchPrompt returns null when no needs_judge", () => {
    const prompt = buildJudgeRelaunchPrompt({ tasks: [{ id: "t1", status: "running" }] });
    expect(prompt).toBeNull();
  });
});
