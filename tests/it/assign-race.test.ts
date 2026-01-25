import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClankerPaths } from "../../src/paths.js";
import { ensureStateDirs } from "../../src/state/ensure-state.js";
import { assignQueuedTasks } from "../../src/state/assign.js";
import { loadTask, listTasks, saveTask } from "../../src/state/tasks.js";

const makeRepoRoot = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "clanker-it-"));
};

describe("integration: assignment race", () => {
  test("prevents double assignment from concurrent schedulers", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "t1",
        status: "queued",
        prompt: "do t1",
      },
    });

    const loadedA = await listTasks({ tasksDir: paths.tasksDir });
    const loadedB = await listTasks({ tasksDir: paths.tasksDir });

    const [assignedA, assignedB] = await Promise.all([
      assignQueuedTasks({
        tasks: loadedA,
        availableSlaves: ["slave-1"],
        paths,
      }),
      assignQueuedTasks({
        tasks: loadedB,
        availableSlaves: ["slave-1"],
        paths,
      }),
    ]);

    expect(assignedA.length + assignedB.length).toBe(1);
    const stored = await loadTask({ tasksDir: paths.tasksDir, id: "t1" });
    expect(stored?.status).toBe("running");
    expect(stored?.assignedSlaveId).toBe("slave-1");

    const locks = (await readdir(paths.locksDir)).filter((entry) => entry.endsWith(".lock"));
    expect(locks).toEqual([]);
  });
});
