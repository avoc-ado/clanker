import { shouldSuppressYarnInstallLine } from "../codex/process-io.js";

describe("shouldSuppressYarnInstallLine", () => {
  test("suppresses Yarn Berry lines", () => {
    expect(shouldSuppressYarnInstallLine({ line: "➤ YN0000: · Yarn 4.12.0" })).toBe(true);
    expect(shouldSuppressYarnInstallLine({ line: "YN0000: ┌ Resolution step" })).toBe(true);
    expect(shouldSuppressYarnInstallLine({ line: "➤ YN0013: │ Fetch step" })).toBe(true);
  });

  test("suppresses yarn install command lines", () => {
    expect(shouldSuppressYarnInstallLine({ line: "yarn install v1.22.19" })).toBe(true);
    expect(shouldSuppressYarnInstallLine({ line: "Running: yarn install --immutable" })).toBe(true);
  });

  test("keeps non-yarn output", () => {
    expect(shouldSuppressYarnInstallLine({ line: "planner ready" })).toBe(false);
    expect(shouldSuppressYarnInstallLine({ line: "" })).toBe(false);
  });
});
