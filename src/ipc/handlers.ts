import { ensureConfigFile, loadConfig } from "../config.js";
import { HEARTBEAT_STALE_MS, JUDGE_PROMPT_STALE_MS, SLAVE_PROMPT_STALE_MS } from "../constants.js";
import type { ClankerPaths } from "../paths.js";
import { getPromptSettings, selectAssignedTask } from "../prompting.js";
import { buildJudgePrompts, buildSlavePrompts } from "../prompting/composite-prompts.js";
import { assignQueuedTasks } from "../state/assign.js";
import { appendEvent } from "../state/events.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { loadState, saveState } from "../state/state.js";
import { acquireTaskLock } from "../state/task-claim.js";
import { listTasks, loadTask, saveTask, type TaskRecord, type TaskStatus } from "../state/tasks.js";
import type { TaskUsageInput } from "../state/task-usage.js";
import { ensureJudgeCheckoutForTask, ensureSlaveCommitForTask } from "../state/task-commits.js";
import { syncSlaveWorktreeForPrompt } from "../state/slave-sync.js";
import { loadJudgeReworkNote } from "../state/rework-note.js";
import { loadState } from "../state/state.js";
import type { IpcHandlers } from "./server.js";
import {
  writeTaskCreate,
  writeTaskHandoff,
  writeTaskNote,
  writeTaskStatus,
} from "./task-gateway.js";

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
  role: "slave" | "judge";
  summary?: string;
  tests?: string;
  diffs?: string;
  risks?: string;
  usage?: TaskUsageInput;
}

interface TaskNotePayload {
  taskId: string;
  role: "slave" | "judge";
  content: string;
  usage?: TaskUsageInput;
}

interface HeartbeatPayload {
  podId: string;
  pid: number;
  role: "planner" | "judge" | "slave";
  ts?: string;
}

interface UsageLimitPayload {
  podId: string;
  role?: "planner" | "judge" | "slave";
  message?: string;
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

const requireRole = ({ value }: { value: unknown }): "slave" | "judge" => {
  if (value !== "slave" && value !== "judge") {
    throw new Error("Role must be slave or judge");
  }
  return value;
};

const parsePodRole = ({ value }: { value: unknown }): "planner" | "judge" | "slave" => {
  if (value === "planner" || value === "judge" || value === "slave") {
    return value;
  }
  return "slave";
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
    usage_limit: async ({ payload }) => {
      const data = payload as UsageLimitPayload;
      const podId = requireString({ value: data?.podId, label: "podId" });
      const role = parsePodRole({ value: data?.role });
      const message = typeof data?.message === "string" ? data.message : "usage limit detected";
      const now = data?.ts && data.ts.trim().length > 0 ? data.ts : new Date().toISOString();
      const state = await loadState({ statePath: paths.statePath });
      if (state.usageLimit.active) {
        return { ok: true };
      }
      const autoPaused = !state.paused;
      const nextState = {
        ...state,
        paused: autoPaused ? true : state.paused,
        usageLimit: {
          active: true,
          detectedAt: now,
          message,
          podId,
          role,
          autoPaused,
        },
      };
      await saveState({ statePath: paths.statePath, state: nextState });
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: now,
          type: "USAGE_LIMIT",
          msg: message,
          slaveId: podId,
          data: { role },
        },
      });
      if (autoPaused) {
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "PAUSED",
            msg: "paused all work (usage limit)",
          },
        });
      }
      return { ok: true };
    },
    task_create: async ({ payload }) => {
      const data = payload as TaskCreatePayload;
      const task = requireTask({ value: data?.task });
      await writeTaskCreate({ paths, task, message: "task created" });
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
      await writeTaskStatus({ paths, taskId, status });
      return { taskId, status };
    },
    task_request: async ({ payload }) => {
      const data = payload as TaskRequestPayload;
      const podId = requireString({ value: data?.podId, label: "podId" });
      const tasks = await listTasks({ tasksDir: paths.tasksDir });
      const config = await loadConfig({ repoRoot: paths.repoRoot });
      const state = await loadState({ statePath: paths.statePath });
      const lockConflictsEnabled = state.lockConflicts.enabled ?? config.lockConflictsEnabled;
      const staleSlaves = await computeStaleSlaves({ paths });
      const promptPaths = { tasksDir: paths.tasksDir, historyDir: paths.historyDir };
      let targetTask = selectAssignedTask({ tasks, slaveId: podId });
      if (!targetTask) {
        const assigned = await assignQueuedTasks({
          tasks,
          availableSlaves: [podId],
          paths,
          staleSlaves,
          lockConflictsEnabled,
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
        const config = await loadConfig({ repoRoot: paths.repoRoot });
        const syncResult = await syncSlaveWorktreeForPrompt({
          repoRoot: paths.repoRoot,
          paths,
          config,
          task: latest,
        });
        const reworkNote = await loadJudgeReworkNote({
          historyDir: paths.historyDir,
          task: syncResult.task,
        });
        const { dispatchPrompt } = buildSlavePrompts({
          task: syncResult.task,
          paths: promptPaths,
          promptSettings,
          syncNote: syncResult.note,
          reworkNote,
        });
        const taskForPrompt = syncResult.task;
        const wasPrompted = Boolean(taskForPrompt.promptedAt);
        const promptedAt = new Date().toISOString();
        taskForPrompt.assignedSlaveId = podId;
        if (taskForPrompt.status === "queued") {
          taskForPrompt.status = "running";
        }
        taskForPrompt.promptedAt = promptedAt;
        await saveTask({ tasksDir: paths.tasksDir, task: taskForPrompt });
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: promptedAt,
            type: "TASK_PROMPTED",
            msg: wasPrompted ? "task prompt re-sent via ipc" : "task prompt requested via ipc",
            slaveId: podId,
            taskId: taskForPrompt.id,
          },
        });
        return { taskId: taskForPrompt.id, prompt: dispatchPrompt, status: taskForPrompt.status };
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
      await writeTaskHandoff({
        paths,
        payload: {
          taskId,
          role,
          summary: data?.summary ?? "",
          tests: data?.tests ?? "",
          diffs: autoDiffs,
          risks: data?.risks ?? "",
          usage: data?.usage,
        },
      });
      return { taskId, role };
    },
    task_note: async ({ payload }) => {
      const data = payload as TaskNotePayload;
      const taskId = requireString({ value: data?.taskId, label: "taskId" });
      const role = requireRole({ value: data?.role });
      const content = requireString({ value: data?.content, label: "content" });
      await writeTaskNote({
        paths,
        payload: {
          taskId,
          role,
          content,
          usage: data?.usage,
        },
      });
      return { taskId, role };
    },
  };
};
