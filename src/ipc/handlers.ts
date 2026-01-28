import { ensureConfigFile, loadConfig } from "../config.js";
import { HEARTBEAT_STALE_MS, JUDGE_PROMPT_STALE_MS, SLAVE_PROMPT_STALE_MS } from "../constants.js";
import type { ClankerPaths } from "../paths.js";
import { getPromptSettings, selectAssignedTask } from "../prompting.js";
import { buildJudgePrompts, buildSlavePrompts } from "../prompting/composite-prompts.js";
import { assignQueuedTasks } from "../state/assign.js";
import { appendEvent } from "../state/events.js";
import { writeHistory, type HistoryRole } from "../state/history.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { acquireTaskLock } from "../state/task-claim.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { listTasks, loadTask, saveTask, type TaskRecord, type TaskStatus } from "../state/tasks.js";
import { buildHandoffContent, buildNoteContent } from "../state/task-content.js";
import { applyTaskUsage, type TaskUsageInput } from "../state/task-usage.js";
import { ensureJudgeCheckoutForTask, ensureSlaveCommitForTask } from "../state/task-commits.js";
import type { IpcHandlers } from "./server.js";

interface TaskCreatePayload {
  task: TaskRecord;
}

interface TaskStatusPayload {
  taskId: string;
  status: TaskStatus;
}

interface TaskRequestPayload {
  podId: string;
}

interface JudgeRequestPayload {
  podId: string;
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

const loadPromptSettingsForRepo = async ({ repoRoot }: { repoRoot: string }) => {
  await ensureConfigFile({ repoRoot });
  const config = await loadConfig({ repoRoot });
  return getPromptSettings({ repoRoot, config });
};

const isTimestampStale = ({
  ts,
  nowMs,
  thresholdMs,
}: {
  ts: string | undefined;
  nowMs: number;
  thresholdMs: number;
}): boolean => {
  if (!ts) {
    return true;
  }
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return nowMs - parsed > thresholdMs;
};

const computeStaleSlaves = async ({ paths }: { paths: ClankerPaths }): Promise<Set<string>> => {
  const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
  const nowMs = Date.now();
  return new Set(
    heartbeats
      .filter((heartbeat) =>
        isHeartbeatStale({ heartbeat, nowMs, thresholdMs: HEARTBEAT_STALE_MS }),
      )
      .map((heartbeat) => heartbeat.slaveId),
  );
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
      const config = await loadConfig({ repoRoot: paths.repoRoot });
      if (status === "needs_judge") {
        const commitResult = await ensureSlaveCommitForTask({
          repoRoot: paths.repoRoot,
          paths,
          config,
          task,
        });
        if (commitResult.status === "commit_failed") {
          throw new Error(
            `Slave commit required before needs_judge (${commitResult.message ?? "commit failed"})`,
          );
        }
      }
      const latestTask = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      if (!latestTask) {
        throw new Error(`Task not found: ${taskId}`);
      }
      await transitionTaskStatus({ task: latestTask, status, paths });
      return { taskId, status };
    },
    task_request: async ({ payload }) => {
      const data = payload as TaskRequestPayload;
      const podId = requireString({ value: data?.podId, label: "podId" });
      const tasks = await listTasks({ tasksDir: paths.tasksDir });
      const staleSlaves = await computeStaleSlaves({ paths });
      const promptPaths = { tasksDir: paths.tasksDir, historyDir: paths.historyDir };
      let targetTask = selectAssignedTask({ tasks, slaveId: podId });
      if (!targetTask) {
        const assigned = await assignQueuedTasks({
          tasks,
          availableSlaves: [podId],
          paths,
          staleSlaves,
        });
        targetTask = assigned[0] ?? null;
      }
      if (!targetTask) {
        return { taskId: null };
      }
      const claim = await acquireTaskLock({
        locksDir: paths.locksDir,
        key: `ipc-prompt-${targetTask.id}`,
      });
      if (!claim) {
        return { taskId: null };
      }
      try {
        const latest = await loadTask({ tasksDir: paths.tasksDir, id: targetTask.id });
        if (!latest || !latest.prompt) {
          return { taskId: null };
        }
        if (latest.assignedSlaveId && latest.assignedSlaveId !== podId) {
          return { taskId: null };
        }
        const nowMs = Date.now();
        if (
          latest.promptedAt &&
          !isTimestampStale({ ts: latest.promptedAt, nowMs, thresholdMs: SLAVE_PROMPT_STALE_MS })
        ) {
          return { taskId: latest.id, status: latest.status };
        }
        const promptSettings = await loadPromptSettingsForRepo({ repoRoot: paths.repoRoot });
        const { dispatchPrompt } = buildSlavePrompts({
          task: latest,
          paths: promptPaths,
          promptSettings,
        });
        const wasPrompted = Boolean(latest.promptedAt);
        const promptedAt = new Date().toISOString();
        latest.assignedSlaveId = podId;
        if (latest.status === "queued") {
          latest.status = "running";
        }
        latest.promptedAt = promptedAt;
        await saveTask({ tasksDir: paths.tasksDir, task: latest });
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: promptedAt,
            type: "TASK_PROMPTED",
            msg: wasPrompted ? "task prompt re-sent via ipc" : "task prompt requested via ipc",
            slaveId: podId,
            taskId: latest.id,
          },
        });
        return { taskId: latest.id, prompt: dispatchPrompt, status: latest.status };
      } finally {
        await claim.release();
      }
    },
    judge_request: async ({ payload }) => {
      const data = payload as JudgeRequestPayload;
      const podId = requireString({ value: data?.podId, label: "podId" });
      const tasks = await listTasks({ tasksDir: paths.tasksDir });
      const promptPaths = { tasksDir: paths.tasksDir, historyDir: paths.historyDir };
      const nowMs = Date.now();
      const targetTask =
        tasks
          .filter((task) => task.status === "needs_judge")
          .filter((task) =>
            isTimestampStale({
              ts: task.judgePromptedAt,
              nowMs,
              thresholdMs: JUDGE_PROMPT_STALE_MS,
            }),
          )
          .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
      if (!targetTask) {
        return { taskId: null };
      }
      const claim = await acquireTaskLock({
        locksDir: paths.locksDir,
        key: `ipc-judge-${targetTask.id}`,
      });
      if (!claim) {
        return { taskId: null };
      }
      try {
        const latest = await loadTask({ tasksDir: paths.tasksDir, id: targetTask.id });
        if (!latest || latest.status !== "needs_judge") {
          return { taskId: null };
        }
        if (
          !isTimestampStale({
            ts: latest.judgePromptedAt,
            nowMs,
            thresholdMs: JUDGE_PROMPT_STALE_MS,
          })
        ) {
          return { taskId: latest.id, status: latest.status };
        }
        const config = await loadConfig({ repoRoot: paths.repoRoot });
        const judgeCheckout = await ensureJudgeCheckoutForTask({
          repoRoot: paths.repoRoot,
          paths,
          config,
          task: latest,
        });
        const { dispatchPrompt } = buildJudgePrompts({
          task: latest,
          paths: promptPaths,
          judgeCheckout,
        });
        const promptedAt = new Date().toISOString();
        latest.judgePromptedAt = promptedAt;
        await saveTask({ tasksDir: paths.tasksDir, task: latest });
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: promptedAt,
            type: "TASK_PROMPTED",
            msg: "judge prompt requested via ipc",
            slaveId: podId,
            taskId: latest.id,
          },
        });
        return { taskId: latest.id, prompt: dispatchPrompt, status: latest.status };
      } finally {
        await claim.release();
      }
    },
    task_handoff: async ({ payload }) => {
      const data = payload as TaskHandoffPayload;
      const taskId = requireString({ value: data?.taskId, label: "taskId" });
      const role = requireRole({ value: data?.role });
      const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      const diffs = data?.diffs ?? "";
      const autoDiffs =
        diffs.trim().length > 0
          ? diffs
          : role === "slave" && task?.slaveCommitSha
            ? `commit: ${task.slaveCommitSha}`
            : diffs;
      const content = buildHandoffContent({
        role,
        summary: data?.summary ?? "",
        tests: data?.tests ?? "",
        diffs: autoDiffs,
        risks: data?.risks ?? "",
      });
      await writeHistory({ historyDir: paths.historyDir, taskId, role, content });
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
