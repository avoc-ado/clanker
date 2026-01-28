import { hasUsageLimitContent, isUsageLimitLine } from "../codex/usage-limit.js";

describe("usage limit detection", () => {
  test("detects usage limit lines", () => {
    expect(isUsageLimitLine({ line: "You've hit your usage limit." })).toBe(true);
    expect(isUsageLimitLine({ line: "You have hit your usage limit." })).toBe(true);
    expect(isUsageLimitLine({ line: "usage limit reached" })).toBe(true);
    expect(isUsageLimitLine({ line: "" })).toBe(false);
  });

  test("detects usage limit in content", () => {
    const content = ["hello", "You've hit your usage limit.", "next"].join("\n");
    expect(hasUsageLimitContent({ content })).toBe(true);
    expect(hasUsageLimitContent({ content: "all clear\nok" })).toBe(false);
  });
});
