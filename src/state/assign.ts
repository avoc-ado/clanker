import type { TaskRecord } from "./tasks.js";
import { saveTask } from "./tasks.js";
import type { ClankerPaths } from "../paths.js";
import { buildLockState, hasLockConflict } from "./locks.js";

const BUSY_STATUSES = new Set(["running", "needs_judge", "rework", "blocked", "paused"]);

export const assignQueuedTasks = async ({
  tasks,
  availableSlaves,
  paths,
  staleSlaves,
}: {
  tasks: TaskRecord[];
  availableSlaves: string[];
  paths: ClankerPaths;
  staleSlaves?: Set<string>;
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
  const lockState = buildLockState({
    tasks: tasks.filter((task) => BUSY_STATUSES.has(task.status) && !isStale(task)),
  });

  for (const task of queued) {
    if (hasLockConflict({ task, lockState })) {
      continue;
    }
    const preferred = task.resumeSlaveId;
    const slaveId =
      preferred && freeSlaves.has(preferred) ? preferred : freeSlaves.values().next().value;
    if (!slaveId) {
      break;
    }
    task.status = "running";
    task.assignedSlaveId = slaveId;
    task.resumeSlaveId = undefined;
    await saveTask({ tasksDir: paths.tasksDir, task });
    updated.push(task);
    freeSlaves.delete(slaveId);
  }

  return updated;
};
