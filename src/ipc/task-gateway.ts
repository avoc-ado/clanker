import { appendEvent } from "../state/events.js";
import { writeHistory } from "../state/history.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { loadTask, saveTask, type TaskRecord, type TaskStatus } from "../state/tasks.js";
import { buildHandoffContent, buildNoteContent } from "../state/task-content.js";
import { applyTaskUsage, type TaskUsageInput } from "../state/task-usage.js";
import type { ClankerPaths } from "../paths.js";
import { sendIpcRequest } from "./client.js";
import { appendIpcSpoolEntry } from "./spool.js";
import { IPC_SPOOL_GRACE_MS } from "../constants.js";

export interface TaskHandoffPayload {
  taskId: string;
  role: "slave" | "judge";
  summary?: string;
  tests?: string;
  diffs?: string;
  risks?: string;
  usage?: TaskUsageInput;
}

export interface TaskDraft extends Omit<TaskRecord, "status"> {
  status?: TaskStatus;
}

export interface TaskNotePayload {
  taskId: string;
  role: "slave" | "judge";
  content: string;
  usage?: TaskUsageInput;
}

const resolveSocketPath = ({ socketPath }: { socketPath?: string }): string | null => {
  const envSocket = process.env.CLANKER_IPC_SOCKET?.trim();
  const resolved = socketPath?.trim() ?? envSocket ?? "";
  return resolved.length > 0 ? resolved : null;
};

const ipcFailures = new Map<string, { firstAt: number }>();

const shouldSpool = ({ socketPath, nowMs }: { socketPath: string; nowMs: number }): boolean => {
  const existing = ipcFailures.get(socketPath);
  if (!existing) {
    ipcFailures.set(socketPath, { firstAt: nowMs });
    return false;
  }
  return nowMs - existing.firstAt >= IPC_SPOOL_GRACE_MS;
};

const clearFailure = ({ socketPath }: { socketPath: string }): void => {
  ipcFailures.delete(socketPath);
};

const tryIpc = async ({
  socketPath,
  type,
  payload,
}: {
  socketPath: string | null;
  type: string;
  payload: unknown;
}): Promise<boolean> => {
  if (!socketPath) {
    return false;
  }
  try {
    const response = await sendIpcRequest({ socketPath, type, payload });
    if (!response.ok) {
      return false;
    }
    clearFailure({ socketPath });
    return true;
  } catch {
    return false;
  }
};

const maybeSpool = async ({
  socketPath,
  paths,
  type,
  payload,
}: {
  socketPath: string | null;
  paths: ClankerPaths;
  type: string;
  payload: unknown;
}): Promise<boolean> => {
  if (!socketPath) {
    return false;
  }
  const nowMs = Date.now();
  if (!shouldSpool({ socketPath, nowMs })) {
    return false;
  }
  await appendIpcSpoolEntry({
    paths,
    entry: {
      ts: new Date(nowMs).toISOString(),
      type,
      payload,
    },
  });
  return true;
};

const recordUsage = async ({
  paths,
  taskId,
  task,
  usage,
}: {
  paths: ClankerPaths;
  taskId: string;
  task: TaskRecord | null;
  usage?: TaskUsageInput;
}): Promise<void> => {
  if (!task || !usage) {
    return;
  }
  if (!applyTaskUsage({ task, usage })) {
    return;
  }
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
};

export const writeTaskCreate = async ({
  paths,
  task,
  message = "task created",
}: {
  paths: ClankerPaths;
  task: TaskDraft;
  message?: string;
}): Promise<void> => {
  const nextTask = {
    ...task,
    status: task.status ?? "queued",
  } satisfies TaskRecord;
  await saveTask({ tasksDir: paths.tasksDir, task: nextTask });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "TASK_CREATED",
      msg: message,
      taskId: nextTask.id,
    },
  });
};

export const writeTaskStatus = async ({
  paths,
  taskId,
  status,
}: {
  paths: ClankerPaths;
  taskId: string;
  status: TaskStatus;
}): Promise<void> => {
  const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  await transitionTaskStatus({ task, status, paths });
};

export const writeTaskNote = async ({
  paths,
  payload,
}: {
  paths: ClankerPaths;
  payload: TaskNotePayload;
}): Promise<void> => {
  await writeHistory({
    historyDir: paths.historyDir,
    taskId: payload.taskId,
    role: payload.role,
    content: buildNoteContent({ content: payload.content }),
  });
  const task = await loadTask({ tasksDir: paths.tasksDir, id: payload.taskId });
  await recordUsage({ paths, taskId: payload.taskId, task, usage: payload.usage });
};

export const writeTaskHandoff = async ({
  paths,
  payload,
}: {
  paths: ClankerPaths;
  payload: TaskHandoffPayload;
}): Promise<void> => {
  const content = buildHandoffContent({
    role: payload.role,
    summary: payload.summary ?? "",
    tests: payload.tests ?? "",
    diffs: payload.diffs ?? "",
    risks: payload.risks ?? "",
  });
  await writeHistory({
    historyDir: paths.historyDir,
    taskId: payload.taskId,
    role: payload.role,
    content,
  });
  const task = await loadTask({ tasksDir: paths.tasksDir, id: payload.taskId });
  await recordUsage({ paths, taskId: payload.taskId, task, usage: payload.usage });
};

export const dispatchTaskCreate = async ({
  paths,
  task,
  message,
  socketPath,
}: {
  paths: ClankerPaths;
  task: TaskDraft;
  message?: string;
  socketPath?: string;
}): Promise<"ipc" | "filesystem" | "spool"> => {
  const ipcSocket = resolveSocketPath({ socketPath });
  const ipcHandled = await tryIpc({
    socketPath: ipcSocket,
    type: "task_create",
    payload: { task },
  });
  if (ipcHandled) {
    return "ipc";
  }
  const spooled = await maybeSpool({
    socketPath: ipcSocket,
    paths,
    type: "task_create",
    payload: { task },
  });
  if (spooled) {
    return "spool";
  }
  await writeTaskCreate({ paths, task, message });
  return "filesystem";
};

export const dispatchTaskStatus = async ({
  paths,
  taskId,
  status,
  socketPath,
}: {
  paths: ClankerPaths;
  taskId: string;
  status: TaskStatus;
  socketPath?: string;
}): Promise<"ipc" | "filesystem" | "spool"> => {
  const ipcSocket = resolveSocketPath({ socketPath });
  const ipcHandled = await tryIpc({
    socketPath: ipcSocket,
    type: "task_status",
    payload: { taskId, status },
  });
  if (ipcHandled) {
    return "ipc";
  }
  const spooled = await maybeSpool({
    socketPath: ipcSocket,
    paths,
    type: "task_status",
    payload: { taskId, status },
  });
  if (spooled) {
    return "spool";
  }
  await writeTaskStatus({ paths, taskId, status });
  return "filesystem";
};

export const dispatchTaskNote = async ({
  paths,
  payload,
  socketPath,
}: {
  paths: ClankerPaths;
  payload: TaskNotePayload;
  socketPath?: string;
}): Promise<"ipc" | "filesystem" | "spool"> => {
  const ipcSocket = resolveSocketPath({ socketPath });
  const ipcHandled = await tryIpc({
    socketPath: ipcSocket,
    type: "task_note",
    payload,
  });
  if (ipcHandled) {
    return "ipc";
  }
  const spooled = await maybeSpool({
    socketPath: ipcSocket,
    paths,
    type: "task_note",
    payload,
  });
  if (spooled) {
    return "spool";
  }
  await writeTaskNote({ paths, payload });
  return "filesystem";
};

export const dispatchTaskHandoff = async ({
  paths,
  payload,
  socketPath,
}: {
  paths: ClankerPaths;
  payload: TaskHandoffPayload;
  socketPath?: string;
}): Promise<"ipc" | "filesystem" | "spool"> => {
  const ipcSocket = resolveSocketPath({ socketPath });
  const ipcHandled = await tryIpc({
    socketPath: ipcSocket,
    type: "task_handoff",
    payload,
  });
  if (ipcHandled) {
    return "ipc";
  }
  const spooled = await maybeSpool({
    socketPath: ipcSocket,
    paths,
    type: "task_handoff",
    payload,
  });
  if (spooled) {
    return "spool";
  }
  await writeTaskHandoff({ paths, payload });
  return "filesystem";
};
