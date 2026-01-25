import { join } from "node:path";
import { loadTask, saveTask } from "../../src/state/tasks.js";
import {
  isRealMode,
  makeTmpRepo,
  resolveCodexCommand,
  runCli,
  setupRealMode,
  writeConfig,
} from "./utils.js";

describe("integration: rework routing", () => {
  test("rework clears promptedAt and keeps assignment", async () => {
    const root = await makeTmpRepo({
      planLines: [
        "Goal: verify rework status.",
        "Requirement: planner must output a minimum of 2 task packets.",
        "Ensure at least two tasks (no upper cap).",
      ],
    });
    if (isRealMode()) {
      await setupRealMode({ root });
    }
    const { codexCommand } = await resolveCodexCommand({ root });
    await writeConfig({ root, codexCommand });

    await runCli({ cwd: root, args: ["doctor", "--fix"] });
    await runCli({ cwd: root, args: ["task", "add", "t2", "do more"] });

    const tasksDir = join(root, ".clanker", "tasks");
    const task = await loadTask({ tasksDir, id: "t2" });
    if (!task) {
      throw new Error("missing task t2");
    }
    task.status = "running";
    task.assignedSlaveId = "slave-1";
    task.promptedAt = new Date().toISOString();
    await saveTask({ tasksDir, task });

    await runCli({ cwd: root, args: ["task", "status", "t2", "rework"] });

    const updated = await loadTask({ tasksDir, id: "t2" });
    if (!updated) {
      throw new Error("missing task t2 after rework");
    }
    expect(updated.status).toBe("rework");
    expect(updated.assignedSlaveId).toBe("slave-1");
    expect(updated.promptedAt).toBeUndefined();
  });

  test("failed clears assignment via CLI status", async () => {
    const root = await makeTmpRepo({
      planLines: [
        "Goal: verify failed status.",
        "Requirement: planner must output a minimum of 2 task packets.",
        "Ensure at least two tasks (no upper cap).",
      ],
    });
    if (isRealMode()) {
      await setupRealMode({ root });
    }
    const { codexCommand } = await resolveCodexCommand({ root });
    await writeConfig({ root, codexCommand });

    await runCli({ cwd: root, args: ["doctor", "--fix"] });
    await runCli({ cwd: root, args: ["task", "add", "t3", "do more"] });

    const tasksDir = join(root, ".clanker", "tasks");
    const task = await loadTask({ tasksDir, id: "t3" });
    if (!task) {
      throw new Error("missing task t3");
    }
    task.status = "running";
    task.assignedSlaveId = "slave-2";
    task.promptedAt = new Date().toISOString();
    await saveTask({ tasksDir, task });

    await runCli({ cwd: root, args: ["task", "status", "t3", "failed"] });

    const updated = await loadTask({ tasksDir, id: "t3" });
    if (!updated) {
      throw new Error("missing task t3 after failed");
    }
    expect(updated.status).toBe("failed");
    expect(updated.assignedSlaveId).toBeUndefined();
    expect(updated.promptedAt).toBeUndefined();
  });
});
