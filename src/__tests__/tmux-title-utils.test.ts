import {
  extractSlaveId,
  normalizePaneTitle,
  parseJudgeTitle,
  parsePlannerTitle,
} from "../tmux-title-utils.js";

describe("tmux title utils", () => {
  test("normalizes clanker prefix", () => {
    expect(normalizePaneTitle({ title: "clanker:planner" })).toBe("planner");
    expect(normalizePaneTitle({ title: "c1" })).toBe("c1");
  });

  test("parses planner titles", () => {
    expect(parsePlannerTitle({ title: "planner" })).toEqual({ id: "", isDefault: true });
    expect(parsePlannerTitle({ title: "clanker:planner-2" })).toEqual({
      id: "2",
      isDefault: false,
    });
  });

  test("parses judge titles", () => {
    expect(parseJudgeTitle({ title: "judge" })).toEqual({ id: "", isDefault: true });
    expect(parseJudgeTitle({ title: "clanker:judge-alpha" })).toEqual({
      id: "alpha",
      isDefault: false,
    });
  });

  test("extracts slave ids", () => {
    expect(extractSlaveId({ title: "clanker:c2" })).toBe("c2");
    expect(extractSlaveId({ title: "c-judge" })).toBeNull();
  });
});
