import type { TaskRecord, TaskStatus } from "./tasks.js";
import { saveTask } from "./tasks.js";
import type { ClankerPaths } from "../paths.js";
import { appendEvent } from "./events.js";

export const transitionTaskStatus = async ({
  task,
  status,
  paths,
}: {
  task: TaskRecord;
  status: TaskStatus;
  paths: ClankerPaths;
}): Promise<TaskRecord> => {
  const previousAssigned = task.assignedSlaveId;
  const eventType = (() => {
    switch (status) {
      case "rework":
        return "TASK_REWORK";
      case "handoff_fix":
        return "TASK_HANDOFF_FIX";
      case "blocked":
        return "TASK_BLOCKED";
      case "needs_judge":
        return "TASK_NEEDS_JUDGE";
      case "done":
        return "TASK_DONE";
      default:
        return "TASK_STATUS";
    }
  })();

  task.status = status;
  if (status === "rework") {
    task.promptedAt = undefined;
  }
  if (status === "handoff_fix" || status === "blocked") {
    task.resumeSlaveId = task.resumeSlaveId ?? previousAssigned;
    task.assignedSlaveId = undefined;
    task.promptedAt = undefined;
  }
  await saveTask({ tasksDir: paths.tasksDir, task });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: eventType,
      msg: `status → ${status}`,
      taskId: task.id,
      slaveId: previousAssigned,
      data: task.usage
        ? {
            tok: task.usage.tokens,
            cost: task.usage.cost,
            judgeCost: task.usage.judgeCost,
          }
        : undefined,
    },
  });
  return task;
};
