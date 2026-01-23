import { normalizeRelaunchTarget, parseRelaunchArgs } from "../commands/relaunch.js";

describe("normalizeRelaunchTarget", () => {
  test("accepts canonical cN ids", () => {
    expect(normalizeRelaunchTarget({ target: "c3" })).toBe("c3");
  });

  test("prefixes numeric ids", () => {
    expect(normalizeRelaunchTarget({ target: "7" })).toBe("c7");
  });

  test("passes through planner or judge ids", () => {
    expect(normalizeRelaunchTarget({ target: "planner" })).toBe("planner");
    expect(normalizeRelaunchTarget({ target: "judge-2" })).toBe("judge-2");
  });
});

describe("parseRelaunchArgs", () => {
  test("defaults to resume mode", () => {
    expect(parseRelaunchArgs({ args: ["2"] })).toEqual({ mode: "resume", target: "c2" });
  });

  test("parses fresh mode", () => {
    expect(parseRelaunchArgs({ args: ["--fresh", "planner-2"] })).toEqual({
      mode: "fresh",
      target: "planner-2",
    });
  });

  test("errors on unknown options", () => {
    expect(() => parseRelaunchArgs({ args: ["--nope", "c1"] })).toThrow("Unknown option");
  });

  test("errors when multiple targets provided", () => {
    expect(() => parseRelaunchArgs({ args: ["c1", "c2"] })).toThrow("Multiple targets");
  });
});
