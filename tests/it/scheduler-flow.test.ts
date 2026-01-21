import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClankerPaths } from "../../src/paths.js";
import { ensureStateDirs } from "../../src/state/ensure-state.js";
import { assignQueuedTasks } from "../../src/state/assign.js";
import { saveTask, listTasks } from "../../src/state/tasks.js";
import { readHeartbeats } from "../../src/state/read-heartbeats.js";
import { isHeartbeatStale } from "../../src/state/heartbeat.js";

const makeRepoRoot = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "clanker-it-"));
};

describe("integration: scheduler + heartbeat", () => {
  test("assigns queued tasks across multiple slaves with resume preference", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "t1",
        status: "queued",
        prompt: "do t1",
        resumeSlaveId: "c2",
      },
    });
    await saveTask({
      tasksDir: paths.tasksDir,
      task: {
        id: "t2",
        status: "queued",
        prompt: "do t2",
      },
    });

    const loaded = await listTasks({ tasksDir: paths.tasksDir });
    const updated = await assignQueuedTasks({
      tasks: loaded,
      availableSlaves: ["c1", "c2"],
      paths,
    });

    const assignedIds = updated.map((task) => task.assignedSlaveId).filter(Boolean);
    expect(assignedIds).toEqual(expect.arrayContaining(["c1", "c2"]));
    const preferred = updated.find((task) => task.id === "t1");
    expect(preferred?.assignedSlaveId).toBe("c2");
  });

  test("reads heartbeats and flags stale entries", async () => {
    const repoRoot = await makeRepoRoot();
    const paths = getClankerPaths({ repoRoot });
    await ensureStateDirs({ paths });

    const nowMs = Date.now();
    const fresh = {
      slaveId: "c1",
      ts: new Date(nowMs - 5_000).toISOString(),
    };
    const stale = {
      slaveId: "c2",
      ts: new Date(nowMs - 40_000).toISOString(),
    };

    await writeFile(join(paths.heartbeatDir, "c1.json"), JSON.stringify(fresh), "utf-8");
    await writeFile(join(paths.heartbeatDir, "c2.json"), JSON.stringify(stale), "utf-8");

    const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
    const staleHeartbeats = heartbeats.filter((hb) =>
      isHeartbeatStale({ heartbeat: hb, nowMs, thresholdMs: 30_000 }),
    );

    expect(staleHeartbeats.map((hb) => hb.slaveId)).toEqual(["c2"]);
  });
});
