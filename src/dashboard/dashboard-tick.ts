import type { ClankerConfig } from "../config.js";
import type { ClankerPaths } from "../paths.js";
import type { PromptSettings } from "../prompting.js";
import { appendEvent } from "../state/events.js";
import { readRecentEvents } from "../state/read-events.js";
import { listTasks, loadTask, saveTask } from "../state/tasks.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { assignQueuedTasks } from "../state/assign.js";
import { acquireTaskLock } from "../state/task-claim.js";
import { computeSlaveCap } from "../scheduler.js";
import { appendMetricSeries, loadMetrics, saveMetrics } from "../state/metrics.js";
import { listDirtyFiles } from "../git.js";
import { countLockConflicts } from "../state/locks.js";
import { loadState } from "../state/state.js";
import { dispatchPlannerPrompt } from "../commands/plan.js";
import { HEARTBEAT_STALE_MS } from "../constants.js";
import { buildTaskFileDispatch, ClankerRole } from "../prompting/role-prompts.js";
import { getCurrentPaneId, listPanes, selectPane, sendKey, sendKeys } from "../tmux.js";
import {
  processPendingActions,
  type CodexPaneState,
  type PendingAction,
} from "./pending-actions.js";
import {
  extractSlaveId,
  normalizePaneTitle,
  parseJudgeTitle,
  parsePlannerTitle,
} from "../tmux-title-utils.js";

export interface PlannerDispatchState {
  pending: boolean;
  sentAt: number;
  taskCountAt: number;
}

export interface DashboardTickState {
  dashboardPaneId: string | null;
  lastSlavePaneId: string | null;
  pendingEscalationPaneId: string | null;
  restorePaneId: string | null;
  lastTickAt: number;
  lastGitFiles: Set<string>;
  staleSlaves: Set<string>;
  lastStatusLine: string;
  idleStartedAt: number;
}

interface DashboardTickDeps {
  appendEvent: typeof appendEvent;
  readRecentEvents: typeof readRecentEvents;
  listTasks: typeof listTasks;
  loadTask: typeof loadTask;
  saveTask: typeof saveTask;
  readHeartbeats: typeof readHeartbeats;
  assignQueuedTasks: typeof assignQueuedTasks;
  acquireTaskLock: typeof acquireTaskLock;
  computeSlaveCap: typeof computeSlaveCap;
  appendMetricSeries: typeof appendMetricSeries;
  loadMetrics: typeof loadMetrics;
  saveMetrics: typeof saveMetrics;
  listDirtyFiles: typeof listDirtyFiles;
  countLockConflicts: typeof countLockConflicts;
  loadState: typeof loadState;
  dispatchPlannerPrompt: typeof dispatchPlannerPrompt;
  getCurrentPaneId: typeof getCurrentPaneId;
  listPanes: typeof listPanes;
  selectPane: typeof selectPane;
  sendKey: typeof sendKey;
  sendKeys: typeof sendKeys;
}

const defaultDeps: DashboardTickDeps = {
  appendEvent,
  readRecentEvents,
  listTasks,
  loadTask,
  saveTask,
  readHeartbeats,
  assignQueuedTasks,
  acquireTaskLock,
  computeSlaveCap,
  appendMetricSeries,
  loadMetrics,
  saveMetrics,
  listDirtyFiles,
  countLockConflicts,
  loadState,
  dispatchPlannerPrompt,
  getCurrentPaneId,
  listPanes,
  selectPane,
  sendKey,
  sendKeys,
};

export const makeDashboardTick = ({
  repoRoot,
  config,
  paths,
  promptSettings,
  knownTaskIds,
  pendingActions,
  plannerDispatchState,
  state,
  inspectPane,
  sendBasePrompt,
  pauseRetryMs,
  plannerPromptTimeoutMs,
  deps,
}: {
  repoRoot: string;
  config: ClankerConfig;
  paths: ClankerPaths;
  promptSettings: PromptSettings;
  knownTaskIds: Set<string>;
  pendingActions: Map<string, PendingAction>;
  plannerDispatchState: PlannerDispatchState;
  state: DashboardTickState;
  inspectPane: ({ paneId }: { paneId: string }) => Promise<CodexPaneState>;
  sendBasePrompt: ({ paneId, role }: { paneId: string; role: ClankerRole }) => Promise<void>;
  pauseRetryMs: number;
  plannerPromptTimeoutMs: number;
  deps?: Partial<DashboardTickDeps>;
}): (() => Promise<void>) => {
  const {
    appendEvent,
    readRecentEvents,
    listTasks,
    loadTask,
    saveTask,
    readHeartbeats,
    assignQueuedTasks,
    acquireTaskLock,
    computeSlaveCap,
    appendMetricSeries,
    loadMetrics,
    saveMetrics,
    listDirtyFiles,
    countLockConflicts,
    loadState,
    dispatchPlannerPrompt,
    getCurrentPaneId,
    listPanes,
    selectPane,
    sendKey,
    sendKeys,
  } = {
    ...defaultDeps,
    ...(deps ?? {}),
  };
  return async () => {
    const tickStartedAt = Date.now();
    const gapMs = tickStartedAt - state.lastTickAt;
    if (gapMs > 60_000) {
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "WAKE",
          msg: `resume after ${Math.round(gapMs / 1000)}s gap`,
        },
      });
    }
    state.lastTickAt = tickStartedAt;
    const liveState = await loadState({ statePath: paths.statePath });
    const panes = await listPanes({ sessionName: config.tmuxFilter });
    const tasks = await listTasks({ tasksDir: paths.tasksDir });
    for (const task of tasks) {
      if (!knownTaskIds.has(task.id)) {
        knownTaskIds.add(task.id);
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "TASK_PACKET",
            msg: task.title ? `packet issued: ${task.title}` : "packet issued",
            taskId: task.id,
          },
        });
      }
    }
    const plannerPanes = panes.filter((pane) => Boolean(parsePlannerTitle({ title: pane.title })));
    const judgePanes = panes.filter((pane) => Boolean(parseJudgeTitle({ title: pane.title })));
    const slavePanes = panes
      .map((pane) => ({ pane, slaveId: extractSlaveId({ title: pane.title }) }))
      .filter((entry): entry is { pane: (typeof panes)[number]; slaveId: string } =>
        Boolean(entry.slaveId),
      );
    const plannerPaneId = plannerPanes[0]?.paneId ?? null;
    const slavePaneCount = slavePanes.length;
    const readyCount = tasks.filter((task) => task.status === "queued").length;
    const reworkCount = tasks.filter((task) => task.status === "rework").length;
    const blockedCount = tasks.filter((task) => task.status === "blocked").length;
    const needsJudgeCount = tasks.filter((task) => task.status === "needs_judge").length;
    const runningCount = tasks.filter((task) => task.status === "running").length;
    const recentForScheduler = await readRecentEvents({ eventsLog: paths.eventsLog, limit: 200 });
    const tokenBurnWindow = recentForScheduler.reduce((sum, event) => {
      const tok = typeof event.data?.tok === "number" ? event.data.tok : 0;
      return sum + tok;
    }, 0);
    const windowStart = recentForScheduler[0]?.ts;
    const windowMinutes = windowStart
      ? Math.max(1, Math.floor((Date.now() - new Date(windowStart).getTime()) / (60 * 1000)))
      : 1;
    const tokenBurnPerMin = Math.floor(tokenBurnWindow / windowMinutes);

    const conflictCount = countLockConflicts({
      tasks: tasks.filter((task) =>
        ["running", "needs_judge", "rework", "blocked"].includes(task.status),
      ),
    });
    const schedulerCap = computeSlaveCap({
      slaveCap: config.slaves,
      readyCount,
      phase: "execute",
      conflictRate: tasks.length === 0 ? 0 : conflictCount / tasks.length,
      integrationBacklog: needsJudgeCount,
      tokenBurnPerMin,
      burnCap: 100,
    });
    const cappedSlavePanes = slavePanes.slice(0, schedulerCap);
    const slavePaneMap = new Map<string, string>(
      cappedSlavePanes.map((entry) => [entry.slaveId, entry.pane.paneId]),
    );
    const promptTask = async ({
      taskId,
      assignedSlaveId,
    }: {
      taskId: string;
      assignedSlaveId?: string;
    }): Promise<void> => {
      const claim = await acquireTaskLock({
        locksDir: paths.locksDir,
        key: `prompt-${taskId}`,
      });
      if (!claim) {
        return;
      }
      try {
        const latest = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
        if (!latest || !latest.prompt || latest.promptedAt) {
          return;
        }
        const slaveId = latest.assignedSlaveId ?? assignedSlaveId;
        if (!slaveId) {
          return;
        }
        const paneId = slavePaneMap.get(slaveId);
        if (!paneId) {
          return;
        }
        const prompt =
          promptSettings.mode === "file"
            ? buildTaskFileDispatch({ taskId: latest.id })
            : latest.prompt;
        await sendKeys({ paneId, text: prompt });
        latest.promptedAt = new Date().toISOString();
        await saveTask({ tasksDir: paths.tasksDir, task: latest });
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "TASK_PROMPTED",
            msg: "sent task prompt",
            slaveId,
            taskId: latest.id,
          },
        });
      } finally {
        await claim.release();
      }
    };

    const currentPane = await getCurrentPaneId();
    if (currentPane && currentPane !== state.dashboardPaneId) {
      const isSlavePane = slavePanes.some((entry) => entry.pane.paneId === currentPane);
      if (isSlavePane) {
        state.lastSlavePaneId = currentPane;
      }
    }
    if (!state.lastSlavePaneId && slavePanes.length > 0) {
      state.lastSlavePaneId = slavePanes[0]?.pane.paneId ?? null;
    }

    const plannerRolePaused = liveState.paused || liveState.pausedRoles.planner;
    const judgeRolePaused = liveState.paused || liveState.pausedRoles.judge;
    const slaveRolePaused = liveState.paused || liveState.pausedRoles.slave;

    if (!plannerRolePaused) {
      for (const pane of plannerPanes) {
        await sendBasePrompt({ paneId: pane.paneId, role: ClankerRole.Planner });
      }
    }
    if (!judgeRolePaused) {
      for (const pane of judgePanes) {
        await sendBasePrompt({ paneId: pane.paneId, role: ClankerRole.Judge });
      }
    }
    if (!slaveRolePaused) {
      for (const entry of slavePanes) {
        await sendBasePrompt({ paneId: entry.pane.paneId, role: ClankerRole.Slave });
      }
    }

    const nowMs = Date.now();

    if (state.pendingEscalationPaneId) {
      const escalation = await inspectPane({ paneId: state.pendingEscalationPaneId });
      if (!escalation.hasEscalation) {
        state.pendingEscalationPaneId = null;
        if (state.restorePaneId) {
          await selectPane({ paneId: state.restorePaneId });
          state.restorePaneId = null;
        }
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "ESCALATION_RESOLVED",
            msg: "command escalation resolved",
          },
        });
      }
    } else {
      for (const entry of slavePanes) {
        const escalation = await inspectPane({ paneId: entry.pane.paneId });
        if (escalation.hasEscalation) {
          const paneLabel = normalizePaneTitle({ title: entry.pane.title });
          const paneSlaveId = extractSlaveId({ title: entry.pane.title }) ?? paneLabel;
          state.pendingEscalationPaneId = entry.pane.paneId;
          state.lastSlavePaneId = entry.pane.paneId;
          state.restorePaneId = state.dashboardPaneId;
          await selectPane({ paneId: entry.pane.paneId });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "ESCALATION_PENDING",
              msg: `command escalation in ${paneLabel}`,
              slaveId: paneSlaveId,
            },
          });
          break;
        }
      }
    }

    await processPendingActions({
      pendingActions,
      inspectPane,
      sendKey,
      retryMs: pauseRetryMs,
      nowMs,
    });

    const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
    const staleThresholdMs = HEARTBEAT_STALE_MS;
    const staleCount = heartbeats.filter((hb) =>
      isHeartbeatStale({ heartbeat: hb, nowMs, thresholdMs: staleThresholdMs }),
    ).length;
    const nextStale = new Set<string>();
    for (const hb of heartbeats) {
      if (isHeartbeatStale({ heartbeat: hb, nowMs, thresholdMs: staleThresholdMs })) {
        nextStale.add(hb.slaveId);
        if (!state.staleSlaves.has(hb.slaveId)) {
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "SLAVE_STALE",
              msg: `stale heartbeat ${hb.slaveId}`,
              slaveId: hb.slaveId,
            },
          });
        }
      }
    }
    for (const slaveId of state.staleSlaves) {
      if (!nextStale.has(slaveId)) {
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "SLAVE_RECOVERED",
            msg: `heartbeat recovered ${slaveId}`,
            slaveId,
          },
        });
      }
    }
    state.staleSlaves = nextStale;
    if (plannerDispatchState.pending) {
      if (tasks.length > plannerDispatchState.taskCountAt) {
        plannerDispatchState.pending = false;
      } else if (Date.now() - plannerDispatchState.sentAt > plannerPromptTimeoutMs) {
        plannerDispatchState.pending = false;
      }
    }
    const plannerPaused = liveState.paused || liveState.pausedRoles.planner;
    if (!plannerPaused && readyCount < config.backlog && !plannerDispatchState.pending) {
      const dispatched = await dispatchPlannerPrompt({ repoRoot, plannerPaneId });
      if (dispatched) {
        plannerDispatchState.pending = true;
        plannerDispatchState.sentAt = Date.now();
        plannerDispatchState.taskCountAt = tasks.length;
      }
    }

    const assignmentsPaused =
      liveState.paused || liveState.pausedRoles.slave || liveState.pausedRoles.planner;
    if (!assignmentsPaused) {
      const availableSlaves = cappedSlavePanes
        .map((entry) => entry.slaveId)
        .filter((slaveId) => !state.staleSlaves.has(slaveId));

      const assigned = await assignQueuedTasks({
        tasks,
        availableSlaves,
        paths,
        staleSlaves: state.staleSlaves,
      });

      for (const task of assigned) {
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "TASK_ASSIGNED",
            msg: `assigned to ${task.assignedSlaveId ?? "-"}`,
            slaveId: task.assignedSlaveId,
            taskId: task.id,
          },
        });
        await promptTask({ taskId: task.id, assignedSlaveId: task.assignedSlaveId });
      }
    }

    for (const task of tasks) {
      if (!task.assignedSlaveId || !task.prompt || task.promptedAt) {
        continue;
      }
      await promptTask({ taskId: task.id, assignedSlaveId: task.assignedSlaveId });
    }

    const statusLine = [
      `panes=${panes.length}`,
      `slavePanes=${slavePaneCount}`,
      `paused=${liveState.paused ? "yes" : "no"}`,
      `tasks=${tasks.length}`,
      `ready=${readyCount}`,
      `run=${runningCount}`,
      `judge=${needsJudgeCount}`,
      `rework=${reworkCount}`,
      `blocked=${blockedCount}`,
      `escalation=${state.pendingEscalationPaneId ? "pending" : "none"}`,
      `hb=${heartbeats.length}`,
      `stale=${staleCount}`,
    ].join(" ");
    if (statusLine !== state.lastStatusLine) {
      state.lastStatusLine = statusLine;
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "DASH_STATUS",
          msg: statusLine,
        },
      });
    }

    const events = await readRecentEvents({ eventsLog: paths.eventsLog, limit: 6 });
    if (events.length > 0) {
      state.idleStartedAt = Date.now();
    }
    const idleMinutes = Math.floor((Date.now() - state.idleStartedAt) / (60 * 1000));

    const tokenBurn = recentForScheduler.reduce((sum, event) => {
      const tok = typeof event.data?.tok === "number" ? event.data.tok : 0;
      return sum + tok;
    }, 0);
    const dirtyFiles = await listDirtyFiles({ cwd: repoRoot });
    const dirtySet = new Set(dirtyFiles);
    const newDirty = dirtyFiles.filter((file) => !state.lastGitFiles.has(file));
    if (newDirty.length > 0) {
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "GIT_CHANGE",
          msg: `changed ${newDirty.slice(0, 2).join(", ")}`,
        },
      });
    }
    state.lastGitFiles = dirtySet;
    const metrics = await loadMetrics({ metricsPath: paths.metricsPath });
    const backlogCount = readyCount;
    const burnHistory = appendMetricSeries({
      series: metrics.burnHistory,
      value: tokenBurnPerMin,
      maxLength: 24,
    });
    const backlogHistory = appendMetricSeries({
      series: metrics.backlogHistory,
      value: backlogCount,
      maxLength: 24,
    });
    await saveMetrics({
      metricsPath: paths.metricsPath,
      metrics: {
        ...metrics,
        updatedAt: new Date().toISOString(),
        taskCount: tasks.length,
        reworkCount,
        conflictCount,
        idleMinutes,
        tokenBurn,
        burnHistory,
        backlogHistory,
      },
    });
  };
};
