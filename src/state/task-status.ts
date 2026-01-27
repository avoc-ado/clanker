import { randomUUID } from "node:crypto";
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
  const previousStatus = task.status;
  const eventType = (() => {
    switch (status) {
      case "rework":
        return "TASK_REWORK";
      case "blocked":
        return "TASK_BLOCKED";
      case "failed":
        return "TASK_FAILED";
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
  if (status === "blocked") {
    task.resumeSlaveId = task.resumeSlaveId ?? previousAssigned;
    task.assignedSlaveId = undefined;
    task.promptedAt = undefined;
  }
  if (status === "failed") {
    task.assignedSlaveId = undefined;
    task.resumeSlaveId = undefined;
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
  if (status === "blocked" && previousStatus !== "blocked") {
    const followupId = `followup-${task.id}-${randomUUID().split("-")[0] ?? "x"}`;
    const followupTask: TaskRecord = {
      id: followupId,
      status: "queued",
      title: task.title ? `Follow-up: ${task.title}` : `Follow-up: ${task.id}`,
      prompt: [
        `Follow-up for blocked task ${task.id}.`,
        `Review ${paths.historyDir} for prior handoffs and notes.`,
        "Resolve the blocker, then complete the original goal.",
      ].join("\n"),
      ownerDirs: task.ownerDirs,
      ownerFiles: task.ownerFiles,
      baseMainSha: task.baseMainSha,
      resumeSlaveId: previousAssigned,
    };
    await saveTask({ tasksDir: paths.tasksDir, task: followupTask });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "TASK_CREATED",
        msg: `follow-up queued for ${task.id}`,
        taskId: followupId,
        slaveId: previousAssigned,
        data: { blockedTaskId: task.id },
      },
    });
  }
  return task;
};
