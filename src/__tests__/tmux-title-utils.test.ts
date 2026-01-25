import {
  extractSlaveId,
  normalizePaneTitle,
  parseJudgeTitle,
  parsePlannerTitle,
} from "../tmux-title-utils.js";

describe("tmux title utils", () => {
  test("normalizes clanker prefix", () => {
    expect(normalizePaneTitle({ title: "clanker:planner-1" })).toBe("planner-1");
    expect(normalizePaneTitle({ title: "slave-1" })).toBe("slave-1");
  });

  test("parses planner titles", () => {
    expect(parsePlannerTitle({ title: "planner" })).toEqual({ id: "1", isDefault: true });
    expect(parsePlannerTitle({ title: "planner-1" })).toEqual({ id: "1", isDefault: true });
    expect(parsePlannerTitle({ title: "clanker:planner-2" })).toEqual({
      id: "2",
      isDefault: false,
    });
  });

  test("parses judge titles", () => {
    expect(parseJudgeTitle({ title: "judge-1" })).toEqual({ id: "1", isDefault: true });
    expect(parseJudgeTitle({ title: "clanker:judge-2" })).toEqual({
      id: "2",
      isDefault: false,
    });
  });

  test("extracts slave ids", () => {
    expect(extractSlaveId({ title: "clanker:slave-2" })).toBe("slave-2");
    expect(extractSlaveId({ title: "c-judge" })).toBeNull();
  });
});
