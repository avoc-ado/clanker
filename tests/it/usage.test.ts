import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpRepo, runCli } from "./utils.js";

describe("integration: task usage", () => {
  test("handoff stores usage and emits usage event", async () => {
    const root = await makeTmpRepo({ planLines: ["Goal: usage tracking."] });

    await runCli({ cwd: root, args: ["task", "add", "t-usage", "do work"] });
    await runCli({
      cwd: root,
      args: [
        "task",
        "handoff",
        "t-usage",
        "slave",
        "--summary",
        "ok",
        "--tests",
        "yarn test",
        "--diffs",
        "x",
        "--risks",
        "none",
        "--tok",
        "1200",
        "--cost",
        "1.25",
        "--judge-cost",
        "0.4",
      ],
    });

    const taskRaw = await readFile(join(root, ".clanker", "tasks", "t-usage.json"), "utf-8");
    const task = JSON.parse(taskRaw) as {
      usage?: { tokens: number; cost: number; judgeCost?: number };
    };
    expect(task.usage?.tokens).toBe(1200);
    expect(task.usage?.cost).toBe(1.25);
    expect(task.usage?.judgeCost).toBe(0.4);

    const eventsRaw = await readFile(join(root, ".clanker", "events.log"), "utf-8");
    expect(eventsRaw).toContain('"type":"TASK_USAGE"');
  });
});
