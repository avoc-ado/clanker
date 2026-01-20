import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ensureExists, makeTmpRepo, runCli, writeCodexStub, writeConfig } from "./utils.js";

describe("integration: plan prompt", () => {
  test("includes plan directive for minimum tasks", async () => {
    const requirement = "Requirement: planner must output at least 2 task packets.";
    const root = await makeTmpRepo({
      planLines: [
        "Goal: echo cli",
        requirement,
        "Split the work across 2 tasks (scaffold + wire).",
      ],
    });
    const stubPath = await writeCodexStub({ root });
    await writeConfig({ root, stubPath });

    await runCli({ cwd: root, args: ["plan"] });

    const promptPath = join(root, ".clanker", "plan-prompt.txt");
    await ensureExists({ path: promptPath, label: "plan prompt" });
    const prompt = await readFile(promptPath, "utf-8");
    expect(prompt).toContain(requirement);
  });
});
