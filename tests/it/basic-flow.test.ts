import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  ensureExists,
  makeTmpRepo,
  runCli,
  runNode,
  resolveCodexCommand,
  writeConfig,
} from "./utils.js";

describe("integration: basic flow", () => {
  test("task + handoff + slave log", async () => {
    const root = await makeTmpRepo({
      planLines: [
        "Goal: verify basic flow.",
        "Requirement: planner must output a minimum of 2 task packets.",
        "Ensure at least two tasks (no upper cap).",
      ],
    });
    const { codexCommand, stubPath } = await resolveCodexCommand({ root });
    await writeConfig({ root, codexCommand });

    await runCli({ cwd: root, args: ["doctor", "--fix"] });
    await runCli({ cwd: root, args: ["task", "add", "t1", "do stuff"] });
    await runCli({ cwd: root, args: ["task", "status", "t1", "needs_judge"] });
    await runCli({
      cwd: root,
      args: [
        "task",
        "handoff",
        "t1",
        "slave",
        "--summary",
        "ok",
        "--tests",
        "yarn test",
        "--diffs",
        "x",
      ],
    });

    if (stubPath) {
      const echo = await runNode({ cwd: root, args: [stubPath, "--echo", "hello"] });
      expect(echo).toContain("echo:hello");
    }

    await runCli({
      cwd: root,
      args: ["slave", "1"],
    });

    const tasksDir = join(root, ".clanker", "tasks");
    const historyDir = join(root, ".clanker", "history");
    const logsDir = join(root, ".clanker", "logs");
    await ensureExists({ path: join(tasksDir, "t1.json"), label: "task file" });
    await ensureExists({ path: join(historyDir, "task-t1-slave.md"), label: "handoff" });

    const logs = await readdir(logsDir);
    expect(logs.length).toBeGreaterThan(0);

    const tail = await runCli({ cwd: root, args: ["tail", "--limit=1", "--no-follow"] });
    expect(tail.length).toBeGreaterThan(0);
  });
});
