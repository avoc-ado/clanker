import type { TaskRecord } from "./tasks.js";
import { loadTask, saveTask } from "./tasks.js";
import type { ClankerPaths } from "../paths.js";
import { buildLockState, hasLockConflict } from "./locks.js";
import { acquireTaskLock } from "./task-claim.js";

const BUSY_STATUSES = new Set(["running", "needs_judge", "rework", "blocked", "paused"]);

export const assignQueuedTasks = async ({
  tasks,
  availableSlaves,
  paths,
  staleSlaves,
  lockConflictsEnabled = true,
}: {
  tasks: TaskRecord[];
  availableSlaves: string[];
  paths: ClankerPaths;
  staleSlaves?: Set<string>;
  lockConflictsEnabled?: boolean;
}): Promise<TaskRecord[]> => {
  const updated: TaskRecord[] = [];
  const staleSet = staleSlaves ?? new Set<string>();
  const isStale = (task: TaskRecord): boolean =>
    Boolean(task.assignedSlaveId && staleSet.has(task.assignedSlaveId));
  const busySlaves = new Set(
    tasks
      .filter((task) => task.assignedSlaveId)
      .filter((task) => BUSY_STATUSES.has(task.status))
      .filter((task) => !isStale(task))
      .map((task) => task.assignedSlaveId ?? ""),
  );

  const freeSlaves = new Set(availableSlaves.filter((slave) => !busySlaves.has(slave)));
  const queued = tasks.filter((task) => task.status === "queued");
  const lockState = lockConflictsEnabled
    ? buildLockState({
        tasks: tasks.filter((task) => BUSY_STATUSES.has(task.status) && !isStale(task)),
      })
    : {
        lockedDirs: new Set<string>(),
        lockedFiles: new Set<string>(),
        lockedFileTopDirs: new Set<string>(),
      };

  for (const task of queued) {
    if (lockConflictsEnabled && hasLockConflict({ task, lockState })) {
      continue;
    }
    const claim = await acquireTaskLock({
      locksDir: paths.locksDir,
      key: `assign-${task.id}`,
    });
    if (!claim) {
      continue;
    }
    try {
      const latest = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
      if (!latest || latest.status !== "queued") {
        continue;
      }
      if (lockConflictsEnabled && hasLockConflict({ task: latest, lockState })) {
        continue;
      }
      const preferred = latest.resumeSlaveId;
      const slaveId =
        preferred && freeSlaves.has(preferred) ? preferred : freeSlaves.values().next().value;
      if (!slaveId) {
        break;
      }
      latest.status = "running";
      latest.assignedSlaveId = slaveId;
      latest.resumeSlaveId = undefined;
      await saveTask({ tasksDir: paths.tasksDir, task: latest });
      updated.push(latest);
      freeSlaves.delete(slaveId);
    } finally {
      await claim.release();
    }
  }

  return updated;
};
