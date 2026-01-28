import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";
import {
  dispatchTaskCreate,
  dispatchTaskHandoff,
  dispatchTaskNote,
  dispatchTaskStatus,
  writeTaskStatus,
} from "../ipc/task-gateway.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadTask, saveTask } from "../state/tasks.js";
import { IPC_DOWN_CACHE_MS } from "../constants.js";

describe("task gateway", () => {
  test("dispatchTaskCreate writes to filesystem when ipc is unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });

    await dispatchTaskCreate({
      paths,
      task: { id: "t1", status: "queued", prompt: "do it" },
      message: "task created",
    });

    const created = await loadTask({ tasksDir: paths.tasksDir, id: "t1" });
    expect(created?.id).toBe("t1");
    const events = await readFile(paths.eventsLog, "utf-8");
    expect(events).toContain("TASK_CREATED");
  });

  test("dispatchTaskNote writes history and usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: { id: "t2", status: "running", prompt: "do" },
    });

    await dispatchTaskNote({
      paths,
      payload: {
        taskId: "t2",
        role: "slave",
        content: "note",
        usage: { tokens: 5, cost: 2 },
      },
    });

    const history = await readFile(join(paths.historyDir, "task-t2-slave.md"), "utf-8");
    expect(history).toContain("note");
    const updated = await loadTask({ tasksDir: paths.tasksDir, id: "t2" });
    expect(updated?.usage?.tokens).toBe(5);
    await rm(root, { recursive: true, force: true });
  });

  test("dispatchTaskHandoff writes history", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: { id: "t3", status: "running", prompt: "do" },
    });

    await dispatchTaskHandoff({
      paths,
      payload: {
        taskId: "t3",
        role: "judge",
        summary: "ok",
        tests: "none",
        diffs: "diff",
        risks: "none",
      },
    });

    const history = await readFile(join(paths.historyDir, "task-t3-judge.md"), "utf-8");
    expect(history).toContain("ok");
    await rm(root, { recursive: true, force: true });
  });

  test("dispatchTaskNote ignores empty usage payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: { id: "t4", status: "running", prompt: "do" },
    });

    await dispatchTaskNote({
      paths,
      payload: {
        taskId: "t4",
        role: "slave",
        content: "note",
        usage: {},
      },
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: "t4" });
    expect(updated?.usage).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  test("dispatchTaskCreate spools after ipc grace window", async () => {
    jest.useFakeTimers();
    const envSocket = process.env.CLANKER_IPC_SOCKET;
    try {
      const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
      const paths = getClankerPaths({ repoRoot: root });
      await ensureStateDirs({ paths });
      const socketPath = join(tmpdir(), `clanker-ipc-${randomUUID()}.sock`);
      process.env.CLANKER_IPC_SOCKET = socketPath;
      const start = new Date("2024-01-01T00:00:00Z");
      jest.setSystemTime(start);

      const first = await dispatchTaskCreate({
        paths,
        task: { id: "t5", status: "queued", prompt: "do it" },
      });
      expect(first).toBe("filesystem");

      jest.setSystemTime(new Date(start.getTime() + IPC_DOWN_CACHE_MS + 10));
      const second = await dispatchTaskCreate({
        paths,
        task: { id: "t6", status: "queued", prompt: "do it" },
      });
      expect(second).toBe("spool");

      const spooled = await readFile(join(paths.stateDir, "ipc-spool.ndjson"), "utf-8");
      expect(spooled).toContain('"task_create"');
      const task = await loadTask({ tasksDir: paths.tasksDir, id: "t6" });
      expect(task).toBeNull();
      await rm(root, { recursive: true, force: true });
    } finally {
      process.env.CLANKER_IPC_SOCKET = envSocket;
      jest.useRealTimers();
    }
  });

  test("dispatchTaskStatus writes to filesystem when ipc is unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: { id: "t7", status: "queued", prompt: "do" },
    });

    const result = await dispatchTaskStatus({
      paths,
      taskId: "t7",
      status: "running",
    });

    expect(result).toBe("filesystem");
    const updated = await loadTask({ tasksDir: paths.tasksDir, id: "t7" });
    expect(updated?.status).toBe("running");
    await rm(root, { recursive: true, force: true });
  });

  test("writeTaskStatus throws when task is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await expect(
      writeTaskStatus({
        paths,
        taskId: "missing",
        status: "running",
      }),
    ).rejects.toThrow("Task not found");
    await rm(root, { recursive: true, force: true });
  });
});
