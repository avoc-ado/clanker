import type { ClankerConfig } from "../config.js";
import type { ClankerPaths } from "../paths.js";
import type { PromptSettings } from "../prompting.js";
import { appendEvent } from "../state/events.js";
import { readRecentEvents } from "../state/read-events.js";
import { listTasks, loadTask, saveTask } from "../state/tasks.js";
import type { TaskRecord } from "../state/tasks.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { assignQueuedTasks } from "../state/assign.js";
import { acquireTaskLock } from "../state/task-claim.js";
import { computeSlaveCap } from "../scheduler.js";
import { appendMetricSeries, loadMetrics, saveMetrics } from "../state/metrics.js";
import { listDirtyFiles } from "../git.js";
import { buildLockState, countLockConflicts, hasLockConflict } from "../state/locks.js";
import { loadState, saveState } from "../state/state.js";
import type { PromptApprovalRequest, PromptApprovalState } from "../state/state.js";
import { dispatchPlannerPrompt, preparePlannerPrompt } from "../commands/plan.js";
import { HEARTBEAT_STALE_MS, JUDGE_PROMPT_STALE_MS } from "../constants.js";
import { ClankerRole } from "../prompting/role-prompts.js";
import { buildJudgePrompts, buildSlavePrompts } from "../prompting/composite-prompts.js";
import { ensureJudgeCheckoutForTask } from "../state/task-commits.js";
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
  lastApprovalId: string | null;
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
  saveState: typeof saveState;
  dispatchPlannerPrompt: typeof dispatchPlannerPrompt;
  preparePlannerPrompt: typeof preparePlannerPrompt;
  ensureJudgeCheckoutForTask: typeof ensureJudgeCheckoutForTask;
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
  saveState,
  dispatchPlannerPrompt,
  preparePlannerPrompt,
  ensureJudgeCheckoutForTask,
  getCurrentPaneId,
  listPanes,
  selectPane,
  sendKey,
  sendKeys,
};

const BUSY_STATUSES = new Set(["running", "needs_judge", "rework", "blocked", "paused"]);

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
    saveState,
    dispatchPlannerPrompt,
    preparePlannerPrompt,
    ensureJudgeCheckoutForTask,
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
    let liveState = await loadState({ statePath: paths.statePath });
    let approvalState: PromptApprovalState = liveState.promptApprovals;
    const persistApprovals = async ({
      nextApprovals,
    }: {
      nextApprovals: PromptApprovalState;
    }): Promise<void> => {
      approvalState = nextApprovals;
      liveState = { ...liveState, promptApprovals: nextApprovals };
      await saveState({ statePath: paths.statePath, state: liveState });
    };
    const hasApprovalKey = ({ key }: { key: string }): boolean =>
      approvalState.queue.some((entry) => entry.key === key) || approvalState.approved?.key === key;
    const enqueueApproval = async ({
      request,
    }: {
      request: PromptApprovalRequest;
    }): Promise<boolean> => {
      if (hasApprovalKey({ key: request.key })) {
        return false;
      }
      const nextApprovals = {
        ...approvalState,
        queue: [...approvalState.queue, request],
      };
      await persistApprovals({ nextApprovals });
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "PROMPT_PENDING",
          msg: `approval needed for ${request.role}`,
          taskId: request.taskId,
          slaveId: request.assignedSlaveId,
          data: { kind: request.kind },
        },
      });
      return true;
    };
    const panes = await listPanes({ sessionPrefix: config.tmuxFilter });
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
    const uniqueSlavePanes = [
      ...new Map(slavePanes.map((entry) => [entry.slaveId, entry])).values(),
    ];
    const plannerPaneId = plannerPanes[0]?.paneId ?? null;
    const slavePaneCount = uniqueSlavePanes.length;
    const needsJudgeTasks = tasks
      .filter((task) => task.status === "needs_judge")
      .sort((a, b) => a.id.localeCompare(b.id));
    const readyCount = tasks.filter((task) => task.status === "queued").length;
    const reworkCount = tasks.filter((task) => task.status === "rework").length;
    const blockedCount = tasks.filter((task) => task.status === "blocked").length;
    const needsJudgeCount = needsJudgeTasks.length;
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
    const cappedSlavePanes = uniqueSlavePanes.slice(0, schedulerCap);
    const slavePaneMap = new Map<string, string>(
      cappedSlavePanes.map((entry) => [entry.slaveId, entry.pane.paneId]),
    );
    const brokerMode = Boolean(process.env.CLANKER_IPC_SOCKET?.trim());
    const promptPaths = { tasksDir: paths.tasksDir, historyDir: paths.historyDir };
    const isJudgePromptStale = ({
      task,
      nowMs,
    }: {
      task: { judgePromptedAt?: string };
      nowMs: number;
    }) => {
      if (!task.judgePromptedAt) {
        return true;
      }
      const parsed = new Date(task.judgePromptedAt).getTime();
      if (!Number.isFinite(parsed)) {
        return true;
      }
      return nowMs - parsed > JUDGE_PROMPT_STALE_MS;
    };
    const sendApprovedPrompt = async ({
      approved,
    }: {
      approved: PromptApprovalRequest;
    }): Promise<"sent" | "skip" | "retry"> => {
      if (approved.kind === "planner") {
        if (!plannerPaneId) {
          return "retry";
        }
        await sendKeys({ paneId: plannerPaneId, text: approved.dispatch });
        await appendEvent({
          eventsLog: paths.eventsLog,
          event: {
            ts: new Date().toISOString(),
            type: "PLAN_SENT",
            msg: "sent plan prompt to planner",
            slaveId: "planner-1",
          },
        });
        plannerDispatchState.pending = true;
        plannerDispatchState.sentAt = Date.now();
        plannerDispatchState.taskCountAt = tasks.length;
        return "sent";
      }
      if (approved.kind === "judge-task") {
        const taskId = approved.taskId;
        if (!taskId) {
          return "skip";
        }
        const judgePaneId = judgePanes[0]?.paneId ?? null;
        if (!judgePaneId) {
          return "retry";
        }
        const paneState = await inspectPane({ paneId: judgePaneId });
        if (paneState.isWorking || paneState.hasEscalation || !paneState.hasPrompt) {
          return "retry";
        }
        const task = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
        if (!task) {
          return "skip";
        }
        const judgeCheckout = await ensureJudgeCheckoutForTask({
          repoRoot,
          paths,
          config,
          task,
        });
        const latestTask = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
        const taskForPrompt = latestTask ?? task;
        const { dispatchPrompt } = buildJudgePrompts({
          task: taskForPrompt,
          paths: promptPaths,
          judgeCheckout,
        });
        await sendKeys({ paneId: judgePaneId, text: dispatchPrompt });
        return "sent";
      }
      const taskId = approved.taskId;
      if (!taskId) {
        return "skip";
      }
      const latest = await loadTask({ tasksDir: paths.tasksDir, id: taskId });
      if (!latest || !latest.prompt || latest.promptedAt) {
        return "skip";
      }
      const slaveId = latest.assignedSlaveId ?? approved.assignedSlaveId;
      if (!slaveId) {
        return "retry";
      }
      const paneId = slavePaneMap.get(slaveId);
      if (!paneId) {
        return "retry";
      }
      await sendKeys({ paneId, text: approved.dispatch });
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
      return "sent";
    };

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
        const { displayPrompt, dispatchPrompt } = buildSlavePrompts({
          task: latest,
          promptSettings,
          paths: promptPaths,
        });
        if (!approvalState.autoApprove.slave) {
          const approvalKey = `task:${latest.id}:slave`;
          await enqueueApproval({
            request: {
              id: approvalKey,
              key: approvalKey,
              role: "slave",
              kind: "slave-task",
              prompt: displayPrompt,
              dispatch: dispatchPrompt,
              createdAt: new Date().toISOString(),
              taskId: latest.id,
              taskTitle: latest.title,
              assignedSlaveId: slaveId,
            },
          });
          return;
        }
        await sendKeys({ paneId, text: dispatchPrompt });
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
      const isSlavePane = uniqueSlavePanes.some((entry) => entry.pane.paneId === currentPane);
      if (isSlavePane) {
        state.lastSlavePaneId = currentPane;
      }
    }
    if (!state.lastSlavePaneId && uniqueSlavePanes.length > 0) {
      state.lastSlavePaneId = uniqueSlavePanes[0]?.pane.paneId ?? null;
    }

    const judgeRolePaused = liveState.paused || liveState.pausedRoles.judge;

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
      for (const entry of uniqueSlavePanes) {
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

    if (approvalState.approved) {
      const approved = approvalState.approved;
      const outcome = await sendApprovedPrompt({ approved });
      if (outcome !== "retry") {
        const nextApprovals = { ...approvalState, approved: null };
        await persistApprovals({ nextApprovals });
        if (outcome === "skip") {
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "PROMPT_SKIPPED",
              msg: `prompt no longer needed for ${approved.role}`,
              taskId: approved.taskId,
              slaveId: approved.assignedSlaveId,
              data: { kind: approved.kind },
            },
          });
        }
      }
    }

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
      const approvalKey = "planner:backlog";
      if (approvalState.autoApprove.planner) {
        if (plannerPaneId) {
          const paneState = await inspectPane({ paneId: plannerPaneId });
          if (!paneState.isWorking && !paneState.hasEscalation && paneState.hasPrompt) {
            const dispatched = await dispatchPlannerPrompt({ repoRoot, plannerPaneId });
            if (dispatched) {
              plannerDispatchState.pending = true;
              plannerDispatchState.sentAt = Date.now();
              plannerDispatchState.taskCountAt = tasks.length;
            }
          }
        } else {
          const dispatched = await dispatchPlannerPrompt({ repoRoot, plannerPaneId });
          if (dispatched) {
            plannerDispatchState.pending = true;
            plannerDispatchState.sentAt = Date.now();
            plannerDispatchState.taskCountAt = tasks.length;
          }
        }
      } else if (!hasApprovalKey({ key: approvalKey })) {
        const prepared = await preparePlannerPrompt({ repoRoot });
        if (prepared) {
          await enqueueApproval({
            request: {
              id: approvalKey,
              key: approvalKey,
              role: "planner",
              kind: "planner",
              prompt: prepared.prompt,
              dispatch: prepared.dispatch,
              createdAt: new Date().toISOString(),
            },
          });
        }
      }
    }

    const assignmentsPaused =
      liveState.paused || liveState.pausedRoles.slave || liveState.pausedRoles.planner;
    if (!brokerMode && !assignmentsPaused) {
      const availableSlaves = [...new Set(cappedSlavePanes.map((entry) => entry.slaveId))].filter(
        (slaveId) => !state.staleSlaves.has(slaveId),
      );

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

    if (!brokerMode && !judgeRolePaused && needsJudgeTasks.length > 0) {
      const judgePaneId = judgePanes[0]?.paneId ?? null;
      if (judgePaneId) {
        const paneState = await inspectPane({ paneId: judgePaneId });
        if (paneState.hasPrompt && !paneState.isWorking && !paneState.hasEscalation) {
          const nowMs = Date.now();
          const task =
            needsJudgeTasks.find((entry) => isJudgePromptStale({ task: entry, nowMs })) ?? null;
          if (task) {
            if (!approvalState.autoApprove.judge) {
              const { displayPrompt, dispatchPrompt } = buildJudgePrompts({
                task,
                paths: promptPaths,
              });
              const approvalKey = `task:${task.id}:judge`;
              await enqueueApproval({
                request: {
                  id: approvalKey,
                  key: approvalKey,
                  role: "judge",
                  kind: "judge-task",
                  prompt: displayPrompt,
                  dispatch: dispatchPrompt,
                  createdAt: new Date().toISOString(),
                  taskId: task.id,
                  taskTitle: task.title,
                },
              });
            } else {
              const claim = await acquireTaskLock({
                locksDir: paths.locksDir,
                key: `judge-prompt-${task.id}`,
              });
              if (claim) {
                try {
                  const latest = await loadTask({ tasksDir: paths.tasksDir, id: task.id });
                  if (latest && latest.status === "needs_judge") {
                    if (isJudgePromptStale({ task: latest, nowMs })) {
                      const judgeCheckout = await ensureJudgeCheckoutForTask({
                        repoRoot,
                        paths,
                        config,
                        task: latest,
                      });
                      const { dispatchPrompt } = buildJudgePrompts({
                        task: latest,
                        paths: promptPaths,
                        judgeCheckout,
                      });
                      await sendKeys({ paneId: judgePaneId, text: dispatchPrompt });
                      latest.judgePromptedAt = new Date().toISOString();
                      await saveTask({ tasksDir: paths.tasksDir, task: latest });
                    }
                  }
                } finally {
                  await claim.release();
                }
              }
            }
          }
        }
      }
    }

    if (!brokerMode) {
      for (const task of tasks) {
        if (!task.assignedSlaveId || !task.prompt || task.promptedAt) {
          continue;
        }
        await promptTask({ taskId: task.id, assignedSlaveId: task.assignedSlaveId });
      }
    }

    const slaveIds = slavePanes.map((entry) => entry.slaveId);
    const uniqueSlaveIds = [...new Set(slaveIds)];
    const duplicateSlaveIds = uniqueSlaveIds.filter(
      (slaveId) => slaveIds.filter((candidate) => candidate === slaveId).length > 1,
    );
    const staleSet = state.staleSlaves;
    const isStale = (task: TaskRecord): boolean =>
      Boolean(task.assignedSlaveId && staleSet.has(task.assignedSlaveId));
    const busyTasksForLocks = tasks.filter(
      (task) => Boolean(task.assignedSlaveId) && BUSY_STATUSES.has(task.status) && !isStale(task),
    );
    const busySlaveIds = new Set(
      busyTasksForLocks
        .map((task) => task.assignedSlaveId)
        .filter((slaveId): slaveId is string => Boolean(slaveId)),
    );
    const availableSlaveIds = [...new Set(cappedSlavePanes.map((entry) => entry.slaveId))].filter(
      (slaveId) => !staleSet.has(slaveId),
    );
    const freeSlaveCount = availableSlaveIds.filter((slaveId) => !busySlaveIds.has(slaveId)).length;
    const lockState = buildLockState({ tasks: busyTasksForLocks });
    const queuedTasks = tasks.filter((task) => task.status === "queued");
    const lockBlockedCount = queuedTasks.filter((task) =>
      hasLockConflict({ task, lockState }),
    ).length;
    const assignableCount = Math.max(
      0,
      Math.min(queuedTasks.length - lockBlockedCount, freeSlaveCount),
    );

    const statusLine = [
      `panes=${panes.length}`,
      `slavePanes=${slavePaneCount}`,
      `slaveIds=${uniqueSlaveIds.length}${duplicateSlaveIds.length > 0 ? "!" : ""}`,
      `paused=${liveState.paused ? "yes" : "no"}`,
      `tasks=${tasks.length}`,
      `ready=${readyCount}`,
      `run=${runningCount}`,
      `judge=${needsJudgeCount}`,
      `rework=${reworkCount}`,
      `blocked=${blockedCount}`,
      `free=${freeSlaveCount}`,
      `assignable=${assignableCount}`,
      `lockBlocked=${lockBlockedCount}`,
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
