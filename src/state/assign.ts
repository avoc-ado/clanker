import type { TaskRecord } from "./tasks.js";
import { saveTask } from "./tasks.js";
import type { ClankerPaths } from "../paths.js";
import { buildLockState, hasLockConflict } from "./locks.js";

const BUSY_STATUSES = new Set([
  "running",
  "needs_judge",
  "rework",
  "blocked",
  "paused",
  "handoff_fix",
]);

export const assignQueuedTasks = async ({
  tasks,
  availableSlaves,
  paths,
}: {
  tasks: TaskRecord[];
  availableSlaves: string[];
  paths: ClankerPaths;
}): Promise<TaskRecord[]> => {
  const updated: TaskRecord[] = [];
  const busySlaves = new Set(
    tasks
      .filter((task) => task.assignedSlaveId)
      .filter((task) => BUSY_STATUSES.has(task.status))
      .map((task) => task.assignedSlaveId ?? ""),
  );

  const freeSlaves = new Set(availableSlaves.filter((slave) => !busySlaves.has(slave)));
  const queued = tasks.filter((task) => task.status === "queued");
  const lockState = buildLockState({ tasks: tasks.filter((task) => BUSY_STATUSES.has(task.status)) });

  for (const task of queued) {
    if (hasLockConflict({ task, lockState })) {
      continue;
    }
    const preferred = task.resumeSlaveId;
    const slaveId = preferred && freeSlaves.has(preferred) ? preferred : freeSlaves.values().next().value;
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
