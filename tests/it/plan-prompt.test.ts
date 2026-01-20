import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ensureExists, makeTmpRepo, resolveCodexCommand, runCli, writeConfig } from "./utils.js";

describe("integration: plan prompt", () => {
  test("includes plan directive for minimum tasks", async () => {
    const requirement = "Requirement: planner must output a minimum of 2 task packets.";
    const root = await makeTmpRepo({
      planLines: ["Goal: echo cli", requirement, "Ensure at least two tasks (no upper cap)."],
    });
    const { codexCommand } = await resolveCodexCommand({ root });
    await writeConfig({ root, codexCommand });

    await runCli({ cwd: root, args: ["plan"] });

    const promptPath = join(root, ".clanker", "plan-prompt.txt");
    await ensureExists({ path: promptPath, label: "plan prompt" });
    const prompt = await readFile(promptPath, "utf-8");
    expect(prompt).toContain(requirement);
  });
});
