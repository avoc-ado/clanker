import { buildHandoffContent, buildNoteContent } from "../state/task-content.js";

describe("task content", () => {
  test("buildHandoffContent includes sections", () => {
    const content = buildHandoffContent({
      role: "slave",
      summary: "sum",
      tests: "tests",
      diffs: "diffs",
      risks: "risks",
    });
    expect(content).toContain("# slave handoff");
    expect(content).toContain("## Summary");
    expect(content).toContain("sum");
  });

  test("buildNoteContent handles empty", () => {
    expect(buildNoteContent({ content: "" })).toBe("(none)");
  });
});
