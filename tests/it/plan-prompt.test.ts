import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  ensureExists,
  makeTmpRepo,
  resolveCodexCommand,
  runCliInteractive,
  writeConfig,
} from "./utils.js";

describe("integration: plan prompt", () => {
  test("includes plan directive for minimum tasks", async () => {
    const requirement = "Requirement: planner must output a minimum of 2 task packets.";
    const root = await makeTmpRepo({
      planFixture: "tests/it/fixtures/plan-basic.md",
    });
    const { codexCommand } = await resolveCodexCommand({ root });
    await writeConfig({ root, codexCommand });

    const result = await runCliInteractive({
      cwd: root,
      args: ["resume"],
      inputLines: [],
      timeoutMs: 1500,
    });
    expect(result.timedOut).toBe(true);

    const promptPath = join(root, ".clanker", "plan-prompt.txt");
    await ensureExists({ path: promptPath, label: "plan prompt" });
    const prompt = await readFile(promptPath, "utf-8");
    expect(prompt).toContain(requirement);
    expect(prompt).toContain("clanker task add");
  });
});
