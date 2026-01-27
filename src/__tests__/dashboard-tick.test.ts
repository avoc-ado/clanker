import type { Heartbeat } from "../state/heartbeat.js";
import type { ClankerEvent } from "../state/events.js";
import type { TaskRecord } from "../state/tasks.js";
import type { ClankerState } from "../state/state.js";
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
    const saveState = async () => undefined;
    const loadState = async () => ({
      paused: false,
      pausedRoles: { planner: false, judge: false, slave: false },
      promptApprovals: {
        autoApprove: { planner: true, judge: true, slave: true },
        queue: [],
        approved: null,
      },
      tasks: [],
    });
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const preparePlannerPrompt = async () => ({
      prompt: "plan prompt",
      dispatch: "dispatch",
      promptPath: ".clanker/plan-prompt.txt",
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
      lastApprovalId: null,
    };

    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 1,
        backlog: 1,
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
        saveState,
        dispatchPlannerPrompt,
        preparePlannerPrompt,
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
    expect(
      sendKeysCalls.some(
        (call) =>
          call.text.includes("clanker slave") && call.text.includes("/repo/.clanker/tasks/t1.json"),
      ),
    ).toBe(true);
    expect(pendingActions.size).toBe(0);
    expect(dashboardState.pendingEscalationPaneId).toBeNull();
    expect(saveTaskCalls.length).toBeGreaterThan(0);
  });

  test("queues approvals when auto-approve is off", async () => {
    const appendEventCalls: ClankerEvent[] = [];
    const appendEvent = async ({ event }: { event: ClankerEvent }) => {
      appendEventCalls.push(event);
    };
    const readRecentEvents = async () => [];
    const baseTask: TaskRecord = {
      id: "t1",
      status: "queued",
      assignedSlaveId: "slave-1",
      prompt: "do thing",
    };
    const tasks: TaskRecord[] = [baseTask];
    const listTasks = async () => tasks;
    const loadTask = async () => ({ ...baseTask });
    const saveTask = async () => undefined;
    const readHeartbeats = async () => [];
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
    const listDirtyFiles = async () => [];
    const countLockConflicts = () => 0;
    let savedState: unknown = null;
    const saveState = async ({ state }: { state: unknown }) => {
      savedState = state;
    };
    const loadState = async () => ({
      paused: false,
      pausedRoles: { planner: false, judge: false, slave: false },
      promptApprovals: {
        autoApprove: { planner: false, judge: false, slave: false },
        queue: [],
        approved: null,
      },
      tasks: [],
    });
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const preparePlannerPrompt = async () => ({
      prompt: "plan prompt",
      dispatch: "dispatch",
      promptPath: ".clanker/plan-prompt.txt",
    });
    const getCurrentPaneId = async () => "pane-slave";
    const listPanes = async () => [
      { paneId: "pane-planner", title: "clanker:planner-1" },
      { paneId: "pane-judge", title: "clanker:judge-1" },
      { paneId: "pane-slave", title: "clanker:slave-1" },
    ];
    const selectPane = async () => undefined;
    const sendKey = async () => undefined;
    const sendKeysCalls: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sendKeysCalls.push({ paneId, text });
    };
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });

    const pendingActions = new Map<string, PendingAction>();
    const dashboardState = {
      dashboardPaneId: "pane-dashboard",
      lastSlavePaneId: null,
      pendingEscalationPaneId: null,
      restorePaneId: null,
      lastTickAt: Date.now(),
      lastGitFiles: new Set<string>(),
      staleSlaves: new Set<string>(),
      lastStatusLine: "",
      idleStartedAt: Date.now(),
      lastApprovalId: null,
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
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/repo/.clanker/plan-prompt.txt",
      },
      knownTaskIds: new Set<string>(),
      pendingActions,
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: dashboardState,
      inspectPane,
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
        saveState,
        dispatchPlannerPrompt,
        preparePlannerPrompt,
        getCurrentPaneId,
        listPanes,
        selectPane,
        sendKey,
        sendKeys,
      },
    });

    await tick();

    expect(sendKeysCalls.length).toBe(0);
    expect(
      appendEventCalls.some((event) => event.type === "PROMPT_PENDING" && event.taskId === "t1"),
    ).toBe(true);
  });

  test("sends approved slave prompt and clears approval", async () => {
    const appendEvent = async () => undefined;
    const readRecentEvents = async () => [];
    const task: TaskRecord = {
      id: "t1",
      status: "queued",
      assignedSlaveId: "slave-1",
      prompt: "do thing",
    };
    const listTasks = async () => [task];
    const loadTask = async () => ({ ...task });
    const saveTask = async () => undefined;
    const readHeartbeats = async () => [];
    const assignQueuedTasks = async () => [];
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
    const listDirtyFiles = async () => [];
    const countLockConflicts = () => 0;
    let savedState: unknown = null;
    const saveState = async ({ state }: { state: unknown }) => {
      savedState = state;
    };
    const loadState = async () =>
      ({
        paused: false,
        pausedRoles: { planner: false, judge: false, slave: false },
        promptApprovals: {
          autoApprove: { planner: false, judge: false, slave: false },
          queue: [],
          approved: {
            id: "task:t1:slave",
            key: "task:t1:slave",
            role: "slave",
            kind: "slave-task",
            prompt: "prompt",
            dispatch: "dispatch",
            createdAt: new Date("2026-01-24T00:00:00.000Z").toISOString(),
            taskId: "t1",
            assignedSlaveId: "slave-1",
          },
        },
        tasks: [],
      }) satisfies ClankerState;
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const preparePlannerPrompt = async () => ({
      prompt: "plan prompt",
      dispatch: "dispatch",
      promptPath: ".clanker/plan-prompt.txt",
    });
    const getCurrentPaneId = async () => "pane-slave";
    const listPanes = async () => [{ paneId: "pane-slave", title: "clanker:slave-1" }];
    const selectPane = async () => undefined;
    const sendKey = async () => undefined;
    const sendKeysCalls: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sendKeysCalls.push({ paneId, text });
    };
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });

    const pendingActions = new Map<string, PendingAction>();
    const dashboardState = {
      dashboardPaneId: "pane-dashboard",
      lastSlavePaneId: null,
      pendingEscalationPaneId: null,
      restorePaneId: null,
      lastTickAt: Date.now(),
      lastGitFiles: new Set<string>(),
      staleSlaves: new Set<string>(),
      lastStatusLine: "",
      idleStartedAt: Date.now(),
      lastApprovalId: null,
    };

    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 1,
        backlog: 1,
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
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/repo/.clanker/plan-prompt.txt",
      },
      knownTaskIds: new Set<string>(),
      pendingActions,
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: dashboardState,
      inspectPane,
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
        saveState,
        dispatchPlannerPrompt,
        preparePlannerPrompt,
        getCurrentPaneId,
        listPanes,
        selectPane,
        sendKey,
        sendKeys,
      },
    });

    await tick();

    expect(sendKeysCalls.length).toBe(1);
    const saved = savedState as { promptApprovals?: { approved?: unknown } };
    expect(saved.promptApprovals?.approved ?? null).toBeNull();
  });

  test("sends approved planner prompt", async () => {
    const appendEvent = async () => undefined;
    const readRecentEvents = async () => [];
    const listTasks = async () => [];
    const loadTask = async () => null;
    const saveTask = async () => undefined;
    const readHeartbeats = async () => [];
    const assignQueuedTasks = async () => [];
    const acquireTaskLock = async () => ({ release: async () => undefined });
    const computeSlaveCap = () => 0;
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
    const listDirtyFiles = async () => [];
    const countLockConflicts = () => 0;
    let savedState: unknown = null;
    const saveState = async ({ state }: { state: unknown }) => {
      savedState = state;
    };
    const loadState = async () =>
      ({
        paused: false,
        pausedRoles: { planner: false, judge: false, slave: false },
        promptApprovals: {
          autoApprove: { planner: false, judge: false, slave: false },
          queue: [],
          approved: {
            id: "planner:backlog",
            key: "planner:backlog",
            role: "planner",
            kind: "planner",
            prompt: "prompt",
            dispatch: "dispatch",
            createdAt: new Date("2026-01-24T00:00:00.000Z").toISOString(),
          },
        },
        tasks: [],
      }) satisfies ClankerState;
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const preparePlannerPrompt = async () => ({
      prompt: "plan prompt",
      dispatch: "dispatch",
      promptPath: ".clanker/plan-prompt.txt",
    });
    const getCurrentPaneId = async () => "pane-dashboard";
    const listPanes = async () => [{ paneId: "pane-planner", title: "clanker:planner-1" }];
    const selectPane = async () => undefined;
    const sendKey = async () => undefined;
    const sendKeysCalls: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sendKeysCalls.push({ paneId, text });
    };
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });

    const pendingActions = new Map<string, PendingAction>();
    const dashboardState = {
      dashboardPaneId: "pane-dashboard",
      lastSlavePaneId: null,
      pendingEscalationPaneId: null,
      restorePaneId: null,
      lastTickAt: Date.now(),
      lastGitFiles: new Set<string>(),
      staleSlaves: new Set<string>(),
      lastStatusLine: "",
      idleStartedAt: Date.now(),
      lastApprovalId: null,
    };
    const plannerDispatchState = { pending: false, sentAt: 0, taskCountAt: 0 };

    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 0,
        backlog: 1,
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
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/repo/.clanker/plan-prompt.txt",
      },
      knownTaskIds: new Set<string>(),
      pendingActions,
      plannerDispatchState,
      state: dashboardState,
      inspectPane,
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
        saveState,
        dispatchPlannerPrompt,
        preparePlannerPrompt,
        getCurrentPaneId,
        listPanes,
        selectPane,
        sendKey,
        sendKeys,
      },
    });

    await tick();

    expect(sendKeysCalls.length).toBe(1);
    expect(plannerDispatchState.pending).toBe(true);
    const saved = savedState as { promptApprovals?: { approved?: unknown } };
    expect(saved.promptApprovals?.approved ?? null).toBeNull();
  });

  test("sends approved judge prompt", async () => {
    const appendEvent = async () => undefined;
    const readRecentEvents = async () => [];
    const task: TaskRecord = {
      id: "t1",
      status: "needs_judge",
      assignedSlaveId: "slave-1",
      prompt: "do thing",
      title: "title",
    };
    const listTasks = async () => [task];
    const loadTask = async () => ({ ...task });
    const saveTask = async () => undefined;
    const readHeartbeats = async () => [];
    const assignQueuedTasks = async () => [];
    const acquireTaskLock = async () => ({ release: async () => undefined });
    const computeSlaveCap = () => 0;
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
    const listDirtyFiles = async () => [];
    const countLockConflicts = () => 0;
    let savedState: unknown = null;
    const saveState = async ({ state }: { state: unknown }) => {
      savedState = state;
    };
    const loadState = async () =>
      ({
        paused: false,
        pausedRoles: { planner: false, judge: false, slave: false },
        promptApprovals: {
          autoApprove: { planner: false, judge: false, slave: false },
          queue: [],
          approved: {
            id: "task:t1:judge",
            key: "task:t1:judge",
            role: "judge",
            kind: "judge-task",
            prompt: "prompt",
            dispatch: "dispatch",
            createdAt: new Date("2026-01-24T00:00:00.000Z").toISOString(),
            taskId: "t1",
          },
        },
        tasks: [],
      }) satisfies ClankerState;
    const dispatchPlannerPrompt = async () => ({
      promptPath: ".clanker/plan-prompt.txt",
      dispatched: true,
    });
    const preparePlannerPrompt = async () => ({
      prompt: "plan prompt",
      dispatch: "dispatch",
      promptPath: ".clanker/plan-prompt.txt",
    });
    const getCurrentPaneId = async () => "pane-dashboard";
    const listPanes = async () => [{ paneId: "pane-judge", title: "clanker:judge-1" }];
    const selectPane = async () => undefined;
    const sendKey = async () => undefined;
    const sendKeysCalls: Array<{ paneId: string; text: string }> = [];
    const sendKeys = async ({ paneId, text }: { paneId: string; text: string }) => {
      sendKeysCalls.push({ paneId, text });
    };
    const inspectPane = async () => ({
      hasPrompt: true,
      isWorking: false,
      isPaused: false,
      hasEscalation: false,
    });

    const pendingActions = new Map<string, PendingAction>();
    const dashboardState = {
      dashboardPaneId: "pane-dashboard",
      lastSlavePaneId: null,
      pendingEscalationPaneId: null,
      restorePaneId: null,
      lastTickAt: Date.now(),
      lastGitFiles: new Set<string>(),
      staleSlaves: new Set<string>(),
      lastStatusLine: "",
      idleStartedAt: Date.now(),
      lastApprovalId: null,
    };

    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 0,
        judges: 1,
        slaves: 0,
        backlog: 1,
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
        mode: "inline",
        planPromptPath: ".clanker/plan-prompt.txt",
        planPromptAbsolutePath: "/repo/.clanker/plan-prompt.txt",
      },
      knownTaskIds: new Set<string>(),
      pendingActions,
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: dashboardState,
      inspectPane,
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
        saveState,
        dispatchPlannerPrompt,
        preparePlannerPrompt,
        getCurrentPaneId,
        listPanes,
        selectPane,
        sendKey,
        sendKeys,
      },
    });

    await tick();

    expect(sendKeysCalls.length).toBe(1);
    const saved = savedState as { promptApprovals?: { approved?: unknown } };
    expect(saved.promptApprovals?.approved ?? null).toBeNull();
  });

  test("waits for planner prompt before auto-dispatch", async () => {
    let plannerDispatchCalls = 0;
    const dispatchPlannerPrompt = async () => {
      plannerDispatchCalls += 1;
      return { promptPath: ".clanker/plan-prompt.txt", dispatched: true };
    };
    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 1,
        backlog: 1,
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
      pendingActions: new Map<string, PendingAction>(),
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: {
        dashboardPaneId: null,
        lastSlavePaneId: null,
        pendingEscalationPaneId: null,
        restorePaneId: null,
        lastTickAt: Date.now(),
        lastGitFiles: new Set<string>(),
        staleSlaves: new Set<string>(),
        lastStatusLine: "",
        idleStartedAt: Date.now(),
        lastApprovalId: null,
      },
      inspectPane: async ({ paneId }) => {
        if (paneId === "pane-planner") {
          return { hasPrompt: false, isWorking: false, isPaused: false, hasEscalation: false };
        }
        return { hasPrompt: true, isWorking: false, isPaused: false, hasEscalation: false };
      },
      pauseRetryMs: 1,
      plannerPromptTimeoutMs: 10,
      deps: {
        appendEvent: async () => undefined,
        readRecentEvents: async () => [],
        listTasks: async () => [],
        loadTask: async () => null,
        saveTask: async () => undefined,
        readHeartbeats: async () => [],
        assignQueuedTasks: async () => [],
        acquireTaskLock: async () => ({ release: async () => undefined }),
        computeSlaveCap: () => 1,
        appendMetricSeries: ({ series, value }) => [...series, value],
        loadMetrics: async () => ({
          updatedAt: new Date().toISOString(),
          taskCount: 0,
          reworkCount: 0,
          conflictCount: 0,
          idleMinutes: 0,
          tokenBurn: 0,
          burnHistory: [],
          backlogHistory: [],
        }),
        saveMetrics: async () => undefined,
        listDirtyFiles: async () => [],
        countLockConflicts: () => 0,
        loadState: async () =>
          ({
            paused: false,
            pausedRoles: { planner: false, judge: false, slave: false },
            promptApprovals: {
              autoApprove: { planner: true, judge: true, slave: true },
              queue: [],
              approved: null,
            },
            tasks: [],
          }) satisfies ClankerState,
        saveState: async () => undefined,
        dispatchPlannerPrompt,
        preparePlannerPrompt: async () => null,
        getCurrentPaneId: async () => null,
        listPanes: async () => [{ paneId: "pane-planner", title: "clanker:planner-1" }],
        selectPane: async () => undefined,
        sendKey: async () => undefined,
        sendKeys: async () => undefined,
      },
    });

    await tick();
    expect(plannerDispatchCalls).toBe(0);
  });

  test("dedupes slave panes before slicing for assignment", async () => {
    const tasks: TaskRecord[] = [
      { id: "t1", status: "queued", prompt: "one" },
      { id: "t2", status: "queued", prompt: "two" },
    ];
    const seenAvailableSlaves: string[][] = [];
    const tick = makeDashboardTick({
      repoRoot: "/repo",
      config: {
        planners: 1,
        judges: 1,
        slaves: 3,
        backlog: 0,
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
      pendingActions: new Map<string, PendingAction>(),
      plannerDispatchState: { pending: false, sentAt: 0, taskCountAt: 0 },
      state: {
        dashboardPaneId: "pane-dashboard",
        lastSlavePaneId: null,
        pendingEscalationPaneId: null,
        restorePaneId: null,
        lastTickAt: 0,
        lastGitFiles: new Set<string>(),
        staleSlaves: new Set<string>(),
        lastStatusLine: "",
        idleStartedAt: Date.now(),
        lastApprovalId: null,
      },
      inspectPane: async () => ({
        hasPrompt: true,
        isWorking: false,
        isPaused: false,
        hasEscalation: false,
      }),
      pauseRetryMs: 1,
      plannerPromptTimeoutMs: 10,
      deps: {
        appendEvent: async () => undefined,
        readRecentEvents: async () => [],
        listTasks: async () => tasks,
        loadTask: async ({ id }: { id: string }) => tasks.find((task) => task.id === id) ?? null,
        saveTask: async () => undefined,
        readHeartbeats: async () => [],
        assignQueuedTasks: async ({ availableSlaves }: { availableSlaves: string[] }) => {
          seenAvailableSlaves.push(availableSlaves);
          return [];
        },
        acquireTaskLock: async () => ({ release: async () => undefined }),
        computeSlaveCap: () => 2,
        appendMetricSeries: ({ series, value }: { series: number[]; value: number }) => [
          ...series,
          value,
        ],
        loadMetrics: async () => ({
          updatedAt: new Date().toISOString(),
          taskCount: 0,
          reworkCount: 0,
          conflictCount: 0,
          idleMinutes: 0,
          tokenBurn: 0,
          burnHistory: [],
          backlogHistory: [],
        }),
        saveMetrics: async () => undefined,
        listDirtyFiles: async () => [],
        countLockConflicts: () => 0,
        loadState: async () =>
          ({
            paused: false,
            pausedRoles: { planner: false, judge: false, slave: false },
            promptApprovals: {
              autoApprove: { planner: true, judge: true, slave: true },
              queue: [],
              approved: null,
            },
            tasks: [],
          }) satisfies ClankerState,
        saveState: async () => undefined,
        dispatchPlannerPrompt: async () => null,
        preparePlannerPrompt: async () => null,
        getCurrentPaneId: async () => null,
        listPanes: async () => [
          { paneId: "pane-planner", title: "clanker:planner-1" },
          { paneId: "pane-judge", title: "clanker:judge-1" },
          { paneId: "pane-slave-a", title: "clanker:slave-1" },
          { paneId: "pane-slave-b", title: "clanker:slave-1" },
          { paneId: "pane-slave-c", title: "clanker:slave-2" },
        ],
        selectPane: async () => undefined,
        sendKey: async () => undefined,
        sendKeys: async () => undefined,
      },
    });

    await tick();

    expect(seenAvailableSlaves[0]).toEqual(["slave-1", "slave-2"]);
  });
});
