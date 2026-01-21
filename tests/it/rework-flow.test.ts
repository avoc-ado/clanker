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
  test("handoff_fix preserves resume slave and clears assignment", async () => {
    const root = await makeTmpRepo({
      planLines: [
        "Goal: verify rework routing.",
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
    await runCli({ cwd: root, args: ["task", "add", "t1", "do stuff"] });

    const tasksDir = join(root, ".clanker", "tasks");
    const task = await loadTask({ tasksDir, id: "t1" });
    if (!task) {
      throw new Error("missing task t1");
    }
    task.status = "running";
    task.assignedSlaveId = "c1";
    task.promptedAt = new Date().toISOString();
    await saveTask({ tasksDir, task });

    await runCli({ cwd: root, args: ["task", "status", "t1", "handoff_fix"] });

    const updated = await loadTask({ tasksDir, id: "t1" });
    if (!updated) {
      throw new Error("missing task t1 after handoff_fix");
    }
    expect(updated.status).toBe("handoff_fix");
    expect(updated.assignedSlaveId).toBeUndefined();
    expect(updated.resumeSlaveId).toBe("c1");
    expect(updated.promptedAt).toBeUndefined();

    await runCli({ cwd: root, args: ["task", "status", "t1", "queued"] });
    const queued = await loadTask({ tasksDir, id: "t1" });
    if (!queued) {
      throw new Error("missing task t1 after queued");
    }
    expect(queued.status).toBe("queued");
    expect(queued.resumeSlaveId).toBe("c1");
  });

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
    task.assignedSlaveId = "c1";
    task.promptedAt = new Date().toISOString();
    await saveTask({ tasksDir, task });

    await runCli({ cwd: root, args: ["task", "status", "t2", "rework"] });

    const updated = await loadTask({ tasksDir, id: "t2" });
    if (!updated) {
      throw new Error("missing task t2 after rework");
    }
    expect(updated.status).toBe("rework");
    expect(updated.assignedSlaveId).toBe("c1");
    expect(updated.promptedAt).toBeUndefined();
  });
});
