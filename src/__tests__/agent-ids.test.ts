import { formatJudgeId, formatPlannerId } from "../agent-ids.js";

describe("agent ids", () => {
  test("uses defaults when no id provided", () => {
    expect(formatPlannerId({})).toBe("planner");
    expect(formatJudgeId({})).toBe("judge");
  });

  test("formats planner and judge ids with suffix", () => {
    expect(formatPlannerId({ idRaw: "2" })).toBe("planner-2");
    expect(formatJudgeId({ idRaw: "alpha" })).toBe("judge-alpha");
  });

  test("trims whitespace from ids", () => {
    expect(formatPlannerId({ idRaw: " 3 " })).toBe("planner-3");
    expect(formatJudgeId({ idRaw: " beta " })).toBe("judge-beta");
  });
});
