import { getCliHelp } from "../cli-help.js";

describe("cli help", () => {
  test("includes commands and options", () => {
    const help = getCliHelp();
    expect(help).toContain("clanker — agent harness");
    expect(help).toContain("Commands:");
    expect(help).toContain("dashboard");
    expect(help).toContain("--prompt-file");
    expect(help).toContain("--help");
  });
});
