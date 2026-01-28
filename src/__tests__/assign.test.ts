import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignQueuedTasks } from "../state/assign.js";
import type { TaskRecord } from "../state/tasks.js";
import { saveTask, listTasks } from "../state/tasks.js";
import type { ClankerPaths } from "../paths.js";

const makePaths = async (): Promise<ClankerPaths> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-test-"));
  return {
    repoRoot: root,
    stateDir: join(root, ".clanker"),
    eventsLog: join(root, ".clanker", "events.log"),
    statePath: join(root, ".clanker", "state.json"),
    tasksDir: join(root, ".clanker", "tasks"),
    historyDir: join(root, ".clanker", "history"),
    heartbeatDir: join(root, ".clanker", "heartbeat"),
    metricsPath: join(root, ".clanker", "metrics.json"),
    logsDir: join(root, ".clanker", "logs"),
    locksDir: join(root, ".clanker", "locks"),
    archiveDir: join(root, ".clanker", "archive"),
    archiveTasksDir: join(root, ".clanker", "archive", "tasks"),
    commandHistoryPath: join(root, ".clanker", "command-history.json"),
  };
};

describe("assignQueuedTasks", () => {
  test("assigns queued tasks to available slaves", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const tasks: TaskRecord[] = [
      { id: "t1", status: "queued", prompt: "do t1" },
      { id: "t2", status: "queued", prompt: "do t2" },
    ];

    for (const task of tasks) {
      await saveTask({ tasksDir: paths.tasksDir, task });
    }

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-1"],
      paths,
    });

    expect(updated.length).toBe(1);
    expect(updated[0]?.assignedSlaveId).toBe("slave-1");
  });

  test("no assignment when no slaves available", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const task: TaskRecord = { id: "t3", status: "queued", prompt: "do t3" };
    await saveTask({ tasksDir: paths.tasksDir, task });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: [],
      paths,
    });

    expect(updated.length).toBe(0);
  });

  test("skips busy slave", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const busy: TaskRecord = {
      id: "t4",
      status: "running",
      prompt: "busy",
      assignedSlaveId: "slave-1",
    };
    const queued: TaskRecord = { id: "t5", status: "queued", prompt: "do t5" };
    await saveTask({ tasksDir: paths.tasksDir, task: busy });
    await saveTask({ tasksDir: paths.tasksDir, task: queued });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-1"],
      paths,
    });

    expect(updated.length).toBe(0);
  });

  test("prefers resume slave when available", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const task: TaskRecord = {
      id: "t6",
      status: "queued",
      prompt: "do t6",
      resumeSlaveId: "slave-2",
    };
    await saveTask({ tasksDir: paths.tasksDir, task });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-1", "slave-2"],
      paths,
    });

    expect(updated[0]?.assignedSlaveId).toBe("slave-2");
  });

  test("ignores stale locks when assigning queued tasks", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const busy: TaskRecord = {
      id: "t7",
      status: "running",
      prompt: "busy",
      assignedSlaveId: "slave-1",
      ownerDirs: ["src"],
    };
    const queued: TaskRecord = {
      id: "t8",
      status: "queued",
      prompt: "do t8",
      ownerDirs: ["src/utils"],
    };
    await saveTask({ tasksDir: paths.tasksDir, task: busy });
    await saveTask({ tasksDir: paths.tasksDir, task: queued });

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

  test("skips lock conflicts when disabled", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );

    const busy: TaskRecord = {
      id: "t9",
      status: "running",
      prompt: "busy",
      assignedSlaveId: "slave-1",
      ownerDirs: ["src"],
    };
    const queued: TaskRecord = {
      id: "t10",
      status: "queued",
      prompt: "do t10",
      ownerDirs: ["src"],
    };
    await saveTask({ tasksDir: paths.tasksDir, task: busy });
    await saveTask({ tasksDir: paths.tasksDir, task: queued });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["slave-2"],
      paths,
      lockConflictsEnabled: false,
    });

    expect(updated.length).toBe(1);
    expect(updated[0]?.assignedSlaveId).toBe("slave-2");
  });
});
