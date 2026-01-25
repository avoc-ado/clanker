import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClankerPaths } from "../../src/paths.js";
import { ensureStateDirs } from "../../src/state/ensure-state.js";
import { saveTask, listTasks } from "../../src/state/tasks.js";
import { assignQueuedTasks } from "../../src/state/assign.js";

const makeRepoRoot = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "clanker-it-"));
};

describe("integration: lock conflicts", () => {
  test("blocks queued task when ownerDirs collide", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "busy",
        status: "running",
        prompt: "busy",
        assignedSlaveId: "slave-1",
        ownerDirs: ["src"],
      },
    });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "queued",
        status: "queued",
        prompt: "queued",
        ownerDirs: ["src/utils"],
      },
    });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-2"],
      paths,
    });

    expect(updated.length).toBe(0);
  });

  test("blocks dir owner when file lock exists", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "busy",
        status: "running",
        prompt: "busy",
        assignedSlaveId: "slave-1",
        ownerFiles: ["src/app.ts"],
      },
    });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "queued",
        status: "queued",
        prompt: "queued",
        ownerDirs: ["src"],
      },
    });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-2"],
      paths,
    });

    expect(updated.length).toBe(0);
  });

  test("expires locks for stale slaves", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "busy",
        status: "running",
        prompt: "busy",
        assignedSlaveId: "slave-1",
        ownerDirs: ["src"],
      },
    });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "queued",
        status: "queued",
        prompt: "queued",
        ownerDirs: ["src/utils"],
      },
    });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-2"],
      paths,
      staleSlaves: new Set(["slave-1"]),
    });

    expect(updated.length).toBe(1);
    expect(updated[0]?.assignedSlaveId).toBe("slave-2");
  });
});
