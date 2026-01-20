import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTask, listTasks, saveTask } from "../state/tasks.js";
import type { TaskRecord } from "../state/tasks.js";

describe("tasks", () => {
  test("save and load", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const task: TaskRecord = { id: "t1", status: "queued", prompt: "do" };
    await saveTask({ tasksDir, task });

    const loaded = await loadTask({ tasksDir, id: "t1" });
    expect(loaded?.id).toBe("t1");

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(1);
  });

  test("skips invalid task files", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-bad-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir, writeFile }) => {
      return Promise.all([
        mkdir(tasksDir, { recursive: true }),
        writeFile(join(tasksDir, "bad.json"), JSON.stringify({ id: 1 }), "utf-8"),
      ]);
    });

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(0);
  });

  test("returns null for missing task", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-missing-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const task = await loadTask({ tasksDir, id: "none" });
    expect(task).toBeNull();
  });

  test("throws on invalid task save", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-bad-save-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const badTask = { id: "t6", status: "nope", prompt: "x" } as unknown as TaskRecord;
    await expect(saveTask({ tasksDir, task: badTask })).rejects.toThrow("Invalid task record");
  });

  test("persists usage fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-usage-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const task: TaskRecord = {
      id: "t7",
      status: "queued",
      prompt: "do",
      usage: { tokens: 1200, cost: 0.42, judgeTokens: 200, judgeCost: 0.08 },
    };
    await saveTask({ tasksDir, task });

    const loaded = await loadTask({ tasksDir, id: "t7" });
    expect(loaded?.usage?.tokens).toBe(1200);
    expect(loaded?.usage?.judgeCost).toBe(0.08);
  });

  test("skips invalid usage fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-usage-bad-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir, writeFile }) => {
      return Promise.all([
        mkdir(tasksDir, { recursive: true }),
        writeFile(
          join(tasksDir, "bad.json"),
          JSON.stringify({
            id: "t8",
            status: "queued",
            prompt: "do",
            usage: { tokens: "nope", cost: 0.1 },
          }),
          "utf-8",
        ),
      ]);
    });

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(0);
  });

  test("persists resume slave id", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-resume-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const task: TaskRecord = {
      id: "t9",
      status: "queued",
      prompt: "do",
      resumeSlaveId: "c2",
    };
    await saveTask({ tasksDir, task });

    const loaded = await loadTask({ tasksDir, id: "t9" });
    expect(loaded?.resumeSlaveId).toBe("c2");
  });

  test("persists ownerFiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-owner-files-"));
    const tasksDir = join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(tasksDir, { recursive: true }));

    const task: TaskRecord = {
      id: "t12",
      status: "queued",
      prompt: "do",
      ownerFiles: ["src/index.ts"],
    };
    await saveTask({ tasksDir, task });

    const loaded = await loadTask({ tasksDir, id: "t12" });
    expect(loaded?.ownerFiles?.[0]).toBe("src/index.ts");
  });

  test("skips invalid resume slave id", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-resume-bad-"));
    const tasksDir = join(root, "tasks");
    const fs = await import("node:fs/promises");
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      join(tasksDir, "bad.json"),
      JSON.stringify({ id: "t10", status: "queued", prompt: "do", resumeSlaveId: 7 }),
      "utf-8",
    );

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(0);
  });

  test("skips invalid judge usage fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-usage-judge-bad-"));
    const tasksDir = join(root, "tasks");
    const fs = await import("node:fs/promises");
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      join(tasksDir, "bad.json"),
      JSON.stringify({
        id: "t11",
        status: "queued",
        prompt: "do",
        usage: { tokens: 100, cost: 0.1, judgeTokens: "bad" },
      }),
      "utf-8",
    );

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(0);
  });

  test("skips invalid json file", async () => {
    const root = await mkdtemp(join(tmpdir(), "clanker-tasks-invalid-json-"));
    const tasksDir = join(root, "tasks");
    const fs = await import("node:fs/promises");
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(join(tasksDir, "bad.json"), "{nope", "utf-8");

    const list = await listTasks({ tasksDir });
    expect(list.length).toBe(0);
  });
});
