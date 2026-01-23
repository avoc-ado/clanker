import { findResumeCommand } from "../codex/resume.js";

describe("findResumeCommand", () => {
  test("returns null when no resume command present", () => {
    const text = "done\nno resume here";
    expect(findResumeCommand({ text })).toBeNull();
  });

  test("extracts resume command from line", () => {
    const text = "ok\nResume with: codex resume abc-123 --no-alt-screen";
    expect(findResumeCommand({ text })).toBe("codex resume abc-123 --no-alt-screen");
  });

  test("returns last resume command", () => {
    const text = [
      "codex resume old-1",
      "some output",
      "codex resume new-2 --sandbox workspace-write",
    ].join("\n");
    expect(findResumeCommand({ text })).toBe("codex resume new-2 --sandbox workspace-write");
  });
});
