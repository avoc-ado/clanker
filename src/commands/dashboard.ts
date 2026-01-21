import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import { startDashboard } from "../tui/dashboard.js";
import { capturePane, getCurrentPaneId, listPanes, selectPane, sendKeys } from "../tmux.js";
import { readRecentEvents } from "../state/read-events.js";
import { appendEvent } from "../state/events.js";
import { listTasks, loadTask, saveTask } from "../state/tasks.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { assignQueuedTasks } from "../state/assign.js";
import { computeSlaveCap } from "../scheduler.js";
import { appendMetricSeries, loadMetrics, saveMetrics } from "../state/metrics.js";
import { formatIdleLine } from "../tui/idle-line.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { listDirtyFiles } from "../git.js";
import { countLockConflicts } from "../state/locks.js";
import { formatRibbonLine } from "../tui/format-event.js";
import { buildTaskFileDispatch, getPromptSettings } from "../prompting.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runDashboard = async ({}: {}): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });
  const state = await loadState({ statePath: paths.statePath });
  const version = await (async (): Promise<string> => {
    try {
      const raw = await readFile(join(repoRoot, "package.json"), "utf-8");
      const parsed = JSON.parse(raw) as { version?: string };
      return parsed.version ?? "dev";
    } catch {
      return "dev";
    }
  })();

  let dashboardPaneId: string | null = null;
  let lastSlavePaneId: string | null = null;
  let pendingEscalationPaneId: string | null = null;
  let restorePaneId: string | null = null;
  let lastTickAt = Date.now();
  let lastGitFiles = new Set<string>();
  let staleSlaves = new Set<string>();
  const promptSettings = getPromptSettings({ repoRoot, config });

  const toggleFocus = async (): Promise<void> => {
    if (!dashboardPaneId) {
      return;
    }
    const current = await getCurrentPaneId();
    if (current === dashboardPaneId) {
      if (lastSlavePaneId) {
        await selectPane({ paneId: lastSlavePaneId });
      }
      return;
    }
    await selectPane({ paneId: dashboardPaneId });
  };

  const setPaused = async ({ paused }: { paused: boolean }): Promise<void> => {
    const current = await loadState({ statePath: paths.statePath });
    if (current.paused === paused) {
      return;
    }
    current.paused = paused;
    await saveState({ statePath: paths.statePath, state: current });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: paused ? "PAUSED" : "RESUMED",
        msg: paused ? "paused all work" : "resumed work",
      },
    });
  };

  const dashboard = startDashboard({
    config,
    state,
    version,
    configSummary: `planners:${config.planners} judges:${config.judges} slaves:${config.slaves} tmux:${config.tmuxSession ?? "all"}`,
    onToggleFocus: () => void toggleFocus(),
    onPause: () => {
      void setPaused({ paused: true });
    },
    onResume: () => {
      void setPaused({ paused: false });
    },
    onCommand: (value) => {
      if (value.startsWith("/resume")) {
        void setPaused({ paused: false });
        return;
      }
      if (value.startsWith("/pause")) {
        void setPaused({ paused: true });
        return;
      }
      if (value.startsWith("/task")) {
        const [, id, status] = value.split(/\s+/);
        if (!id || !status) {
          return;
        }
        if (!TASK_SCHEMA.status.includes(status)) {
          return;
        }
        void loadTask({ tasksDir: paths.tasksDir, id }).then((task) => {
          if (!task) {
            return;
          }
          void transitionTaskStatus({ task, status: status as typeof task.status, paths });
        });
      }
    },
  });
  dashboardPaneId = await getCurrentPaneId();

  const escalationPromptMatches = [
    "Would you like to run the following command?",
    "Press enter to confirm",
  ];

  const hasEscalationPrompt = ({ content }: { content: string }): boolean =>
    escalationPromptMatches.some((pattern) => content.includes(pattern));

  let idleStartedAt = Date.now();

  const tick = async (): Promise<void> => {
    const tickStartedAt = Date.now();
    const gapMs = tickStartedAt - lastTickAt;
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
    lastTickAt = tickStartedAt;
    const liveState = await loadState({ statePath: paths.statePath });
    const panes = await listPanes({ sessionName: config.tmuxSession });
    const tasks = await listTasks({ tasksDir: paths.tasksDir });
    const extractSlaveId = ({ title }: { title: string }): string | null => {
      const normalized = title.startsWith("clanker:") ? title.replace("clanker:", "") : title;
      return /^c\d+$/.test(normalized) ? normalized : null;
    };
    const slavePanes = panes
      .map((pane) => ({ pane, slaveId: extractSlaveId({ title: pane.title }) }))
      .filter((entry): entry is { pane: (typeof panes)[number]; slaveId: string } =>
        Boolean(entry.slaveId),
      );
    const slavePaneCount = slavePanes.length;
    const readyCount = tasks.filter((task) => task.status === "queued").length;
    const reworkCount = tasks.filter((task) => task.status === "rework").length;
    const blockedCount = tasks.filter((task) => task.status === "blocked").length;
    const needsJudgeCount = tasks.filter((task) => task.status === "needs_judge").length;
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
        ["running", "needs_judge", "rework", "blocked", "handoff_fix"].includes(task.status),
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

    const currentPane = await getCurrentPaneId();
    if (currentPane && currentPane !== dashboardPaneId) {
      const isSlavePane = slavePanes.some((entry) => entry.pane.paneId === currentPane);
      if (isSlavePane) {
        lastSlavePaneId = currentPane;
      }
    }
    if (!lastSlavePaneId && slavePanes.length > 0) {
      lastSlavePaneId = slavePanes[0]?.pane.paneId ?? null;
    }

    if (pendingEscalationPaneId) {
      const content = await capturePane({ paneId: pendingEscalationPaneId, lines: 80 });
      if (!hasEscalationPrompt({ content })) {
        pendingEscalationPaneId = null;
        if (restorePaneId) {
          await selectPane({ paneId: restorePaneId });
          restorePaneId = null;
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
        const content = await capturePane({ paneId: entry.pane.paneId, lines: 80 });
        if (hasEscalationPrompt({ content })) {
          pendingEscalationPaneId = entry.pane.paneId;
          lastSlavePaneId = entry.pane.paneId;
          restorePaneId = dashboardPaneId;
          await selectPane({ paneId: entry.pane.paneId });
          await appendEvent({
            eventsLog: paths.eventsLog,
            event: {
              ts: new Date().toISOString(),
              type: "ESCALATION_PENDING",
              msg: `command escalation in ${entry.pane.title}`,
              slaveId: entry.pane.title,
            },
          });
          break;
        }
      }
    }

    const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
    const staleCount = heartbeats.filter((hb) => {
      const deltaMs = Date.now() - new Date(hb.ts).getTime();
      return deltaMs > 30_000;
    }).length;
    const nextStale = new Set<string>();
    for (const hb of heartbeats) {
      const deltaMs = Date.now() - new Date(hb.ts).getTime();
      if (deltaMs > 30_000) {
        nextStale.add(hb.slaveId);
        if (!staleSlaves.has(hb.slaveId)) {
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
    for (const slaveId of staleSlaves) {
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
    staleSlaves = nextStale;
    if (!liveState.paused) {
      const availableSlaves = cappedSlavePanes.map((entry) => entry.slaveId);

      const assigned = await assignQueuedTasks({
        tasks,
        availableSlaves,
        paths,
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
        if (task.prompt && !task.promptedAt) {
          const paneId = task.assignedSlaveId ? slavePaneMap.get(task.assignedSlaveId) : null;
          if (paneId) {
            const prompt =
              promptSettings.mode === "file"
                ? buildTaskFileDispatch({ taskId: task.id })
                : task.prompt;
            await sendKeys({ paneId, text: prompt });
            task.promptedAt = new Date().toISOString();
            await saveTask({ tasksDir: paths.tasksDir, task });
            await appendEvent({
              eventsLog: paths.eventsLog,
              event: {
                ts: new Date().toISOString(),
                type: "TASK_PROMPTED",
                msg: "sent task prompt",
                slaveId: task.assignedSlaveId,
                taskId: task.id,
              },
            });
          }
        }
      }
    }

    for (const task of tasks) {
      if (!task.assignedSlaveId || !task.prompt || task.promptedAt) {
        continue;
      }
      const paneId = slavePaneMap.get(task.assignedSlaveId);
      if (!paneId) {
        continue;
      }
      const prompt =
        promptSettings.mode === "file" ? buildTaskFileDispatch({ taskId: task.id }) : task.prompt;
      await sendKeys({ paneId, text: prompt });
      task.promptedAt = new Date().toISOString();
      await saveTask({ tasksDir: paths.tasksDir, task });
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "TASK_PROMPTED",
          msg: "sent task prompt",
          slaveId: task.assignedSlaveId,
          taskId: task.id,
        },
      });
    }

    dashboard.updateStatus({
      paneCount: panes.length,
      slavePaneCount,
      escalation: pendingEscalationPaneId ? "pending" : "none",
      taskCount: tasks.length,
      conflictCount,
      heartbeatCount: heartbeats.length,
      staleCount,
      paused: liveState.paused,
    });
    const events = await readRecentEvents({ eventsLog: paths.eventsLog, limit: 6 });
    const ribbonEvents = await readRecentEvents({ eventsLog: paths.eventsLog, limit: 40 });
    if (events.length > 0) {
      idleStartedAt = Date.now();
    }
    const idleMinutes = Math.floor((Date.now() - idleStartedAt) / (60 * 1000));
    dashboard.updateTail({
      events:
        events.length > 0
          ? events
          : [
              {
                ts: new Date(idleStartedAt).toISOString(),
                type: "IDLE",
                msg: `idle ${formatIdleLine({ idleMinutes })}`,
              },
            ],
    });
    const feedbackLines = ribbonEvents
      .filter((event) =>
        [
          "TASK_DONE",
          "TASK_REWORK",
          "TASK_HANDOFF_FIX",
          "TASK_NEEDS_JUDGE",
          "TASK_BLOCKED",
          "TASK_STATUS",
        ].includes(event.type),
      )
      .slice(-2)
      .map((event) => formatRibbonLine({ event }));
    dashboard.updateRibbon({ lines: feedbackLines });

    const tokenBurn = recentForScheduler.reduce((sum, event) => {
      const tok = typeof event.data?.tok === "number" ? event.data.tok : 0;
      return sum + tok;
    }, 0);
    const dirtyFiles = await listDirtyFiles({ cwd: repoRoot });
    const dirtySet = new Set(dirtyFiles);
    const newDirty = dirtyFiles.filter((file) => !lastGitFiles.has(file));
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
    lastGitFiles = dirtySet;
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

  await tick();
  const interval = setInterval(() => {
    void tick();
  }, 2000);

  process.on("SIGINT", () => {
    clearInterval(interval);
    dashboard.destroy();
  });
  process.on("SIGTERM", () => {
    clearInterval(interval);
    dashboard.destroy();
  });
};
