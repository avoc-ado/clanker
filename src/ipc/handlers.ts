import type { ClankerPaths } from "../paths.js";
import { appendEvent } from "../state/events.js";
import { writeHistory, type HistoryRole } from "../state/history.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { loadTask, saveTask, type TaskRecord, type TaskStatus } from "../state/tasks.js";
import { buildHandoffContent, buildNoteContent } from "../state/task-content.js";
import { applyTaskUsage, type TaskUsageInput } from "../state/task-usage.js";
import type { IpcHandlers } from "./server.js";

interface TaskCreatePayload {
  task: TaskRecord;
}

interface TaskStatusPayload {
  taskId: string;
  status: TaskStatus;
}

interface TaskHandoffPayload {
  taskId: string;
  role: HistoryRole;
  summary?: string;
  tests?: string;
  diffs?: string;
  risks?: string;
  usage?: TaskUsageInput;
}

interface TaskNotePayload {
  taskId: string;
  role: HistoryRole;
  content: string;
  usage?: TaskUsageInput;
}

interface HeartbeatPayload {
  podId: string;
  pid: number;
  role: "planner" | "judge" | "slave";
  ts?: string;
}

const requireString = ({ value, label }: { value: unknown; label: string }): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
};

const requireTask = ({ value }: { value: unknown }): TaskRecord => {
  if (!value || typeof value !== "object") {
    throw new Error("Missing task payload");
  }
  return value as TaskRecord;
};

const requireRole = ({ value }: { value: unknown }): HistoryRole => {
  if (value !== "slave" && value !== "judge") {
    throw new Error("Role must be slave or judge");
  }
  return value;
};

export const buildIpcHandlers = ({ paths }: { paths: ClankerPaths }): IpcHandlers => {
  return {
    hello: async () => ({ ok: true }),
    heartbeat: async ({ payload }) => {
      const data = payload as HeartbeatPayload;
      const podId = requireString({ value: data?.podId, label: "podId" });
      const role = data?.role ?? "slave";
      const pid = typeof data?.pid === "number" ? data.pid : Number(data?.pid);
      if (!Number.isFinite(pid)) {
        throw new Error("Missing pid");
      }
      await writeHeartbeat({
        heartbeatDir: paths.heartbeatDir,
        slaveId: podId,
        pid,
        role,
        ts: data?.ts,
      });
      return { ok: true };
    },
    task_create: async ({ payload }) => {
      const data = payload as TaskCreatePayload;
      const task = requireTask({ value: data?.task });
      if (!task.status) {
        task.status = "queued";
      }
      await saveTask({ tasksDir: paths.tasksDir, task });
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "TASK_CREATED",
          msg: "task created",
          taskId: task.id,
        },
      });
      return { taskId: task.id };
    },
    task_status: async ({ payload }) => {
      const data = payload as TaskStatusPayload;
      const taskId = requireString({ value: data?.taskId, label: "taskId" });
      const status = data?.status as TaskStatus;
      if (!status) {
        throw new Error("Missing status");
      }
      const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      await transitionTaskStatus({ task, status, paths });
      return { taskId, status };
    },
    task_handoff: async ({ payload }) => {
      const data = payload as TaskHandoffPayload;
      const taskId = requireString({ value: data?.taskId, label: "taskId" });
      const role = requireRole({ value: data?.role });
      const content = buildHandoffContent({
        role,
        summary: data?.summary ?? "",
        tests: data?.tests ?? "",
        diffs: data?.diffs ?? "",
        risks: data?.risks ?? "",
      });
      await writeHistory({ historyDir: paths.historyDir, taskId, role, content });
      const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      if (task && data?.usage) {
        const next = applyTaskUsage({ task, usage: data.usage });
        if (next) {
          await saveTask({ tasksDir: paths.tasksDir, task });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "TASK_USAGE",
              msg: "task usage updated",
              taskId,
              slaveId: task.assignedSlaveId,
              data: {
                tok: task.usage?.tokens,
                cost: task.usage?.cost,
                judgeCost: task.usage?.judgeCost,
              },
            },
          });
        }
      }
      return { taskId, role };
    },
    task_note: async ({ payload }) => {
      const data = payload as TaskNotePayload;
      const taskId = requireString({ value: data?.taskId, label: "taskId" });
      const role = requireRole({ value: data?.role });
      const content = buildNoteContent({ content: data?.content ?? "" });
      await writeHistory({ historyDir: paths.historyDir, taskId, role, content });
      const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      if (task && data?.usage) {
        const next = applyTaskUsage({ task, usage: data.usage });
        if (next) {
          await saveTask({ tasksDir: paths.tasksDir, task });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "TASK_USAGE",
              msg: "task usage updated",
              taskId,
              slaveId: task.assignedSlaveId,
              data: {
                tok: task.usage?.tokens,
                cost: task.usage?.cost,
                judgeCost: task.usage?.judgeCost,
              },
            },
          });
        }
      }
      return { taskId, role };
    },
  };
};
