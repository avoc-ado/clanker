import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureExists, makeTmpRepo, runCli, runCliInteractive } from "./utils.js";

describe("integration: resume", () => {
  test("resume toggles paused and emits event", async () => {
    const root = await makeTmpRepo({ planLines: ["Goal: resume flow."] });

    const result = await runCliInteractive({
      cwd: root,
      args: ["resume"],
      inputLines: [],
      timeoutMs: 1500,
    });
    expect(result.timedOut).toBe(true);

    const statePath = join(root, ".clanker", "state.json");
    await ensureExists({ path: statePath, label: "state file" });
    await runCli({ cwd: root, args: ["status"] });

    const stateRaw = await readFile(statePath, "utf-8");
    const state = JSON.parse(stateRaw) as { paused: boolean };
    expect(state.paused).toBe(false);

    const eventsRaw = await readFile(join(root, ".clanker", "events.log"), "utf-8");
    expect(eventsRaw).toContain('"type":"RESUMED"');
  }, 10_000);
});
