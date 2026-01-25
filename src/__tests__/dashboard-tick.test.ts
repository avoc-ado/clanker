import type { Heartbeat } from "../state/heartbeat.js";
import type { ClankerEvent } from "../state/events.js";
import type { TaskRecord } from "../state/tasks.js";
import { ClankerRole } from "../prompting/role-prompts.js";
import type { PendingAction } from "../dashboard/pending-actions.js";
import { makeDashboardTick } from "../dashboard/dashboard-tick.js";

describe("makeDashboardTick", () => {
  test("drives scheduler, escalations, and metrics", async () => {
    const appendEventCalls: ClankerEvent[] = [];
    const appendEvent = async ({ event }: { event: ClankerEvent }) => {
      appendEventCalls.push(event);
    };
    const readRecentEvents = async (): Promise<ClankerEvent[]> => [
      {
        ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
        type: "TOK",
        msg: "token burn",
        data: { tok: 20 },
      },
    ];
    const baseTask: TaskRecord = {
      id: "t1",
      status: "queued",
      assignedSlaveId: "slave-1",
      prompt: "do thing",
    };
    const tasks: TaskRecord[] = [
      baseTask,
      { id: "t2", status: "running", assignedSlaveId: "slave-1" },
      { id: "t3", status: "needs_judge", assignedSlaveId: "slave-1" },
      { id: "t4", status: "rework", assignedSlaveId: "slave-1" },
      { id: "t5", status: "blocked", assignedSlaveId: "slave-1" },
    ];
    const listTasks = async () => tasks;
    const loadTask = async () => ({ ...baseTask });
    const saveTaskCalls: TaskRecord[] = [];
    const saveTask = async ({ task }: { task: TaskRecord }) => {
      saveTaskCalls.push(task);
    };
    let heartbeatPhase: "stale" | "fresh" = "stale";
    const staleHeartbeat: Heartbeat = {
      slaveId: "slave-1",
      ts: new Date("2026-01-24T00:00:00.000Z").toISOString(),
      pid: 42,
    };
    const freshHeartbeat: Heartbeat = {
      slaveId: "slave-1",
      ts: new Date().toISOString(),
      pid: 42,
    };
    const readHeartbeats = async () =>
      heartbeatPhase === "stale" ? [staleHeartbeat] : [freshHeartbeat];
    const assignQueuedTasks = async () => [{ ...baseTask, assignedSlaveId: "slave-1" }];
    const acquireTaskLock = async () => ({ release: async () => undefined });
    const computeSlaveCap = () => 1;
    const appendMetricSeries = ({
      series,
      value,
    }: {
      series: number[];
      value: number;
    }): number[] => [...series, value];
    const loadMetrics = async () => ({
      updatedAt: new Date("2026-01-24T00:00:00.000Z").toISOString(),
      taskCount: 0,
      reworkCount: 0,
      conflictCount: 0,
      idleMinutes: 0,
      tokenBurn: 0,
      burnHistory: [],
      backlogHistory: [],
    });
    const saveMetrics = async () => undefined;
    const listDirtyFiles = async () => ["foo.txt"];
    const countLockConflicts = () => 0;
    const loadState = async () => ({
      paused: false,
      pausedRoles: { planner: false, judge: false, slave: false },
      tasks: [],
    });
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const getCurrentPaneId = async () => "pane-slave";
    const listPanes = async () => [
      { paneId: "pane-planner", title: "clanker:planner-1" },
      { paneId: "pane-judge", title: "clanker:judge-1" },
      { paneId: "pane-slave", title: "clanker:slave-1" },
    ];
    const selectPaneCalls: string[] = [];
    const selectPane = async ({ paneId }: { paneId: string }) => {
      selectPaneCalls.push(paneId);
    };
    const sendKeyCalls: Array<{ paneId: string; key: string }> = [];
    const sendKey = async ({ paneId, key }: { paneId: string; key: string }) => {
      sendKeyCalls.push({ paneId, key });
    };
    const sendKeysCalls: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sendKeysCalls.push({ paneId, text });
    };

    const pendingActions = new Map<string, PendingAction>();
    pendingActions.set("pane-pause", {
      kind: "pause",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });
    pendingActions.set("pane-resume", {
      kind: "resume",
      role: ClankerRole.Slave,
      requestedAt: 0,
    });

    let escalationActive = true;
    let pausePanePaused = false;
    let resumePanePaused = true;
    const inspectPane = async ({ paneId }: { paneId: string }) => {
      if (paneId === "pane-slave") {
        return {
          hasPrompt: true,
          isWorking: true,
          isPaused: false,
          hasEscalation: escalationActive,
        };
      }
      if (paneId === "pane-pause") {
        return {
          hasPrompt: true,
          isWorking: !pausePanePaused,
          isPaused: pausePanePaused,
          hasEscalation: false,
        };
      }
      if (paneId === "pane-resume") {
        return {
          hasPrompt: true,
          isWorking: true,
          isPaused: resumePanePaused,
          hasEscalation: false,
        };
      }
      return {
        hasPrompt: true,
        isWorking: false,
        isPaused: true,
        hasEscalation: false,
      };
    };
    const sendBasePromptCalls: Array<{ paneId: string; role: ClankerRole }> = [];
    const sendBasePrompt = async ({ paneId, role }: { paneId: string; role: ClankerRole }) => {
      sendBasePromptCalls.push({ paneId, role });
    };

    const dashboardState = {
      dashboardPaneId: "pane-dashboard",
      lastSlavePaneId: null,
      pendingEscalationPaneId: null,
      restorePaneId: null,
      lastTickAt: Date.now() - 70_000,
      lastGitFiles: new Set<string>(),
      staleSlaves: new Set<string>(),
      lastStatusLine: "",
      idleStartedAt: Date.now() - 120_000,
    };

    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 1,
        backlog: 2,
        startImmediately: true,
        tmuxFilter: "clanker",
      },
      paths: {
        repoRoot: "/repo",
        stateDir: "/repo/.clanker",
        eventsLog: "/repo/.clanker/events.log",
        statePath: "/repo/.clanker/state.json",
        tasksDir: "/repo/.clanker/tasks",
        historyDir: "/repo/.clanker/history",
        heartbeatDir: "/repo/.clanker/heartbeat",
        metricsPath: "/repo/.clanker/metrics.json",
        logsDir: "/repo/.clanker/logs",
        locksDir: "/repo/.clanker/locks",
        archiveDir: "/repo/.clanker/archive",
        archiveTasksDir: "/repo/.clanker/archive/tasks",
        commandHistoryPath: "/repo/.clanker/command-history.json",
      },
      promptSettings: {
        mode: "file",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/repo/.clanker/plan-prompt.txt",
      },
      knownTaskIds: new Set<string>(),
      pendingActions,
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: dashboardState,
      inspectPane,
      sendBasePrompt,
      pauseRetryMs: 1,
      plannerPromptTimeoutMs: 10,
      deps: {
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
      },
    });

    await tick();

    escalationActive = false;
    pausePanePaused = true;
    resumePanePaused = false;
    heartbeatPhase = "fresh";

    await tick();

    expect(appendEventCalls.length).toBeGreaterThan(0);
    expect(sendKeysCalls.length).toBeGreaterThan(0);
    expect(selectPaneCalls.length).toBeGreaterThan(0);
    expect(sendBasePromptCalls).toContainEqual({
      paneId: "pane-planner",
      role: ClankerRole.Planner,
    });
    expect(pendingActions.size).toBe(0);
    expect(dashboardState.pendingEscalationPaneId).toBeNull();
    expect(saveTaskCalls.length).toBeGreaterThan(0);
  });
});
