import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transitionTaskStatus } from "../state/task-status.js";
import type { ClankerPaths } from "../paths.js";
import { listTasks, saveTask } from "../state/tasks.js";

const makePaths = async (): Promise<ClankerPaths> => {
  const root = await mkdtemp(join(tmpdir(), "clanker-status-"));
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

describe("transitionTaskStatus", () => {
  test("updates task and writes event", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.stateDir, { recursive: true }),
    );

    const task = { id: "t1", status: "queued", prompt: "do", assignedSlaveId: "c1" } as const;
    await saveTask({ tasksDir: paths.tasksDir, task: task });

    await transitionTaskStatus({ task, status: "done", paths });

    const eventRaw = await readFile(paths.eventsLog, "utf-8");
    expect(eventRaw).toContain("TASK_DONE");
  });

  test("marks rework and resets prompt", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.stateDir, { recursive: true }),
    );

    const task = {
      id: "t2",
      status: "needs_judge",
      prompt: "do",
      assignedSlaveId: "c2",
      promptedAt: new Date().toISOString(),
    } as const;
    await saveTask({ tasksDir: paths.tasksDir, task: task });

    await transitionTaskStatus({ task, status: "rework", paths });

    const updated = await import("../state/tasks.js").then(({ loadTask }) =>
      loadTask({ tasksDir: paths.tasksDir, id: "t2" }),
    );
    expect(updated?.status).toBe("rework");
    expect(updated?.assignedSlaveId).toBe("c2");
    expect(updated?.promptedAt).toBeUndefined();
  });

  test("failed clears assignment and emits failed event", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.stateDir, { recursive: true }),
    );

    const task = {
      id: "t3",
      status: "needs_judge",
      prompt: "do",
      assignedSlaveId: "c3",
      promptedAt: new Date().toISOString(),
      resumeSlaveId: "c3",
    } as const;
    await saveTask({ tasksDir: paths.tasksDir, task: task });

    await transitionTaskStatus({ task, status: "failed", paths });

    const updated = await import("../state/tasks.js").then(({ loadTask }) =>
      loadTask({ tasksDir: paths.tasksDir, id: "t3" }),
    );
    expect(updated?.status).toBe("failed");
    expect(updated?.assignedSlaveId).toBeUndefined();
    expect(updated?.resumeSlaveId).toBeUndefined();

    const eventRaw = await readFile(paths.eventsLog, "utf-8");
    expect(eventRaw).toContain("TASK_FAILED");
  });

  test("blocked stores resume and emits blocked event", async () => {
    const paths = await makePaths();
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.tasksDir, { recursive: true }),
    );
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(paths.stateDir, { recursive: true }),
    );

    const task = {
      id: "t4",
      status: "running",
      prompt: "do",
      assignedSlaveId: "c4",
    } as const;
    await saveTask({ tasksDir: paths.tasksDir, task: task });

    await transitionTaskStatus({ task, status: "blocked", paths });

    const updated = await import("../state/tasks.js").then(({ loadTask }) =>
      loadTask({ tasksDir: paths.tasksDir, id: "t4" }),
    );
    expect(updated?.assignedSlaveId).toBeUndefined();
    expect(updated?.resumeSlaveId).toBe("c4");

    const eventRaw = await readFile(paths.eventsLog, "utf-8");
    expect(eventRaw).toContain("TASK_BLOCKED");
    expect(eventRaw).toContain("TASK_CREATED");

    const tasks = await listTasks({ tasksDir: paths.tasksDir });
    const followup = tasks.find((entry) => entry.id.startsWith("followup-t4-"));
    expect(followup?.status).toBe("queued");
    expect(followup?.prompt).toContain("blocked task t4");
  });
});
