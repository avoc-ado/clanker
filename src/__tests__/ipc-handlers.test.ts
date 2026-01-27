import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadTask } from "../state/tasks.js";
import { buildIpcHandlers } from "../ipc/handlers.js";

describe("ipc handlers", () => {
  test("writes tasks, status, handoff, and heartbeat", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const handlers = buildIpcHandlers({ paths });

    await handlers.task_create({
      payload: { task: { id: "t1", status: "queued", prompt: "do" } },
      context: {},
    });
    const created = await loadTask({ tasksDir: paths.tasksDir, id: "t1" });
    expect(created?.id).toBe("t1");

    await handlers.task_status({
      payload: { taskId: "t1", status: "needs_judge" },
      context: {},
    });
    const updated = await loadTask({ tasksDir: paths.tasksDir, id: "t1" });
    expect(updated?.status).toBe("needs_judge");

    await handlers.task_handoff({
      payload: {
        taskId: "t1",
        role: "slave",
        summary: "done",
        tests: "tests",
        diffs: "diffs",
        risks: "risks",
        usage: { tokens: 12, cost: 3 },
      },
      context: {},
    });
    const firstHandoff = await readFile(join(paths.historyDir, "task-t1-slave.md"), "utf-8");
    expect(firstHandoff).toContain("done");
    await handlers.task_handoff({
      payload: {
        taskId: "t1",
        role: "slave",
        summary: "noop-usage",
        usage: {},
      },
      context: {},
    });
    await handlers.task_handoff({
      payload: { taskId: "t1", role: "slave", summary: "followup" },
      context: {},
    });

    await handlers.task_note({
      payload: { taskId: "t1", role: "slave", content: "note", usage: { judgeTokens: 1 } },
      context: {},
    });
    await handlers.task_note({
      payload: { taskId: "t1", role: "slave", content: "note-empty", usage: {} },
      context: {},
    });
    await handlers.task_note({
      payload: { taskId: "t1", role: "slave", content: "note2" },
      context: {},
    });
    const note = await readFile(join(paths.historyDir, "task-t1-slave.md"), "utf-8");
    expect(note).toContain("note");

    await handlers.heartbeat({
      payload: { podId: "slave-1", pid: 123, ts: "2026-01-26T00:00:00.000Z" },
      context: {},
    });
    const hb = await readFile(join(paths.heartbeatDir, "slave-1.json"), "utf-8");
    expect(hb).toContain("slave-1");

    await handlers.task_handoff({
      payload: {
        taskId: "missing",
        role: "slave",
        summary: "noop",
        usage: { tokens: 1 },
      },
      context: {},
    });
    const missingHandoff = await readFile(join(paths.historyDir, "task-missing-slave.md"), "utf-8");
    expect(missingHandoff).toContain("noop");

    await handlers.task_note({
      payload: { taskId: "missing", role: "slave", content: "note", usage: { tokens: 1 } },
      context: {},
    });
    const missingNote = await readFile(join(paths.historyDir, "task-missing-slave.md"), "utf-8");
    expect(missingNote).toContain("note");
  });

  test("task_request assigns work and judge_request returns needs_judge prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const handlers = buildIpcHandlers({ paths });

    await handlers.task_create({
      payload: { task: { id: "t1", status: "queued", prompt: "ship it" } },
      context: {},
    });

    const taskResponse = await handlers.task_request({
      payload: { podId: "slave-1" },
      context: {},
    });
    expect(taskResponse).toMatchObject({ taskId: "t1" });
    expect(String((taskResponse as { prompt?: string }).prompt ?? "")).toContain("clanker slave");

    const assigned = await loadTask({ tasksDir: paths.tasksDir, id: "t1" });
    expect(assigned?.status).toBe("running");
    expect(assigned?.assignedSlaveId).toBe("slave-1");
    expect(Boolean(assigned?.promptedAt)).toBe(true);

    await handlers.task_status({
      payload: { taskId: "t1", status: "needs_judge" },
      context: {},
    });

    const judgeResponse = await handlers.judge_request({
      payload: { podId: "judge-1" },
      context: {},
    });
    expect(judgeResponse).toMatchObject({ taskId: "t1" });
    expect(String((judgeResponse as { prompt?: string }).prompt ?? "")).toContain("clanker judge");
  });

  test("task_request and judge_request return null when queue is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const handlers = buildIpcHandlers({ paths });

    const taskResponse = await handlers.task_request({
      payload: { podId: "slave-1" },
      context: {},
    });
    expect(taskResponse).toMatchObject({ taskId: null });

    const judgeResponse = await handlers.judge_request({
      payload: { podId: "judge-1" },
      context: {},
    });
    expect(judgeResponse).toMatchObject({ taskId: null });
  });

  test("validates payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const handlers = buildIpcHandlers({ paths });

    await expect(handlers.task_create({ payload: {}, context: {} })).rejects.toThrow(
      "Missing task payload",
    );

    await handlers.task_create({
      payload: { task: { id: "t2", prompt: "do" } },
      context: {},
    });
    const created = await loadTask({ tasksDir: paths.tasksDir, id: "t2" });
    expect(created?.status).toBe("queued");

    await expect(handlers.task_status({ payload: { taskId: "t1" }, context: {} })).rejects.toThrow(
      "Missing status",
    );

    await expect(
      handlers.task_status({ payload: { taskId: "missing", status: "done" }, context: {} }),
    ).rejects.toThrow("Task not found");

    await expect(
      handlers.task_handoff({
        payload: { taskId: "t1", role: "owner" },
        context: {},
      }),
    ).rejects.toThrow("Role must be slave or judge");

    await expect(
      handlers.heartbeat({ payload: { podId: "slave-1", role: "slave" }, context: {} }),
    ).rejects.toThrow("Missing pid");
  });
});
