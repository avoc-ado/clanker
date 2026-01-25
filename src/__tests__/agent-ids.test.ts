import { formatJudgeId, formatPlannerId, formatSlaveId } from "../agent-ids.js";

describe("agent ids", () => {
  test("uses defaults when no id provided", () => {
    expect(formatPlannerId({})).toBe("planner-1");
    expect(formatJudgeId({})).toBe("judge-1");
    expect(formatSlaveId({})).toBe("slave-1");
  });

  test("formats planner and judge ids with suffix", () => {
    expect(formatPlannerId({ idRaw: "2" })).toBe("planner-2");
    expect(formatJudgeId({ idRaw: "alpha" })).toBe("judge-alpha");
    expect(formatSlaveId({ idRaw: "4" })).toBe("slave-4");
  });

  test("trims whitespace from ids", () => {
    expect(formatPlannerId({ idRaw: " 3 " })).toBe("planner-3");
    expect(formatJudgeId({ idRaw: " beta " })).toBe("judge-beta");
    expect(formatSlaveId({ idRaw: " 5 " })).toBe("slave-5");
  });
});
