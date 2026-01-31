import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jest } from "@jest/globals";
import { IPC_SPOOL_GRACE_MS } from "../constants.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadTask, saveTask } from "../state/tasks.js";

const sendIpcRequestMock = jest.fn<Promise<{ ok: boolean }>, [unknown]>();
const appendIpcSpoolEntryMock = jest.fn<Promise<void>, [unknown]>();

jest.unstable_mockModule("../ipc/client.js", () => ({
  sendIpcRequest: sendIpcRequestMock,
}));

jest.unstable_mockModule("../ipc/spool.js", () => ({
  appendIpcSpoolEntry: appendIpcSpoolEntryMock,
}));

const { dispatchTaskCreate, dispatchTaskHandoff, dispatchTaskNote, dispatchTaskStatus } =
  await import("../ipc/task-gateway.js");

describe("task gateway ipc", () => {
  beforeEach(() => {
    sendIpcRequestMock.mockReset();
    appendIpcSpoolEntryMock.mockReset();
  });

  test("dispatchTaskCreate returns ipc when request succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    sendIpcRequestMock.mockResolvedValue({ ok: true });

    const result = await dispatchTaskCreate({
      paths,
      task: { id: "t-ipc", status: "queued", prompt: "do" },
      socketPath: join(root, "ipc.sock"),
    });

    expect(result).toBe("ipc");
    const created = await loadTask({ tasksDir: paths.tasksDir, id: "t-ipc" });
    expect(created).toBeNull();
    expect(appendIpcSpoolEntryMock).not.toHaveBeenCalled();
  });

  test("dispatchTaskCreate falls back when ipc response is not ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    sendIpcRequestMock.mockResolvedValue({ ok: false });

    const result = await dispatchTaskCreate({
      paths,
      task: { id: "t-fallback", status: "queued", prompt: "do" },
      socketPath: join(root, "ipc.sock"),
    });

    expect(result).toBe("filesystem");
    const created = await loadTask({ tasksDir: paths.tasksDir, id: "t-fallback" });
    expect(created?.id).toBe("t-fallback");
  });

  test("dispatchTaskNote skips usage updates when task missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });

    await dispatchTaskNote({
      paths,
      payload: {
        taskId: "t-missing",
        role: "slave",
        content: "note",
        usage: { tokens: 1, cost: 1 },
      },
    });

    const history = await readFile(join(paths.historyDir, "task-t-missing-slave.md"), "utf-8");
    expect(history).toContain("note");
    const task = await loadTask({ tasksDir: paths.tasksDir, id: "t-missing" });
    expect(task).toBeNull();
  });

  test("dispatchTaskNote records usage when task exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: { id: "t-usage", status: "running", prompt: "do" },
    });

    await dispatchTaskNote({
      paths,
      payload: {
        taskId: "t-usage",
        role: "slave",
        content: "note",
        usage: { tokens: 2, cost: 1 },
      },
    });

    const updated = await loadTask({ tasksDir: paths.tasksDir, id: "t-usage" });
    expect(updated?.usage?.tokens).toBe(2);
  });

  test("dispatchTaskStatus throws when task is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });

    await expect(
      dispatchTaskStatus({
        paths,
        taskId: "t-missing-status",
        status: "running",
      }),
    ).rejects.toThrow("Task not found");
  });

  test("dispatchTaskHandoff spools after ipc down grace period", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-gateway-ipc-"));
    const paths = getClankerPaths({ repoRoot: root });
    await ensureStateDirs({ paths });
    const socketPath = join(root, "ipc.sock");
    const nowSpy = jest.spyOn(Date, "now");
    sendIpcRequestMock.mockRejectedValue(new Error("ipc down"));

    nowSpy.mockReturnValue(1_000);
    const first = await dispatchTaskHandoff({
      paths,
      payload: { taskId: "t-hand", role: "slave", summary: "summary" },
      socketPath,
    });

    nowSpy.mockReturnValue(1_000 + IPC_SPOOL_GRACE_MS + 1);
    const second = await dispatchTaskHandoff({
      paths,
      payload: { taskId: "t-hand", role: "slave", summary: "summary" },
      socketPath,
    });

    expect(first).toBe("filesystem");
    expect(second).toBe("spool");
    expect(appendIpcSpoolEntryMock).toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
