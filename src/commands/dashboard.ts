import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import {
  capturePane,
  getCurrentPaneId,
  listPanes,
  selectPane,
  sendKey,
  sendKeys,
} from "../tmux.js";
import { readRecentEvents } from "../state/read-events.js";
import { appendEvent } from "../state/events.js";
import type { ClankerEvent } from "../state/events.js";
import { listTasks, loadTask, saveTask } from "../state/tasks.js";
import { readHeartbeats } from "../state/read-heartbeats.js";
import { isHeartbeatStale } from "../state/heartbeat.js";
import { assignQueuedTasks } from "../state/assign.js";
import { acquireTaskLock } from "../state/task-claim.js";
import { computeSlaveCap } from "../scheduler.js";
import { appendMetricSeries, loadMetrics, saveMetrics } from "../state/metrics.js";
import { transitionTaskStatus } from "../state/task-status.js";
import { TASK_SCHEMA } from "../plan/schema.js";
import { listDirtyFiles } from "../git.js";
import { countLockConflicts } from "../state/locks.js";
import { buildTaskFileDispatch, getPromptSettings } from "../prompting.js";
import { dispatchPlannerPrompt } from "./plan.js";
import { formatDateDivider, formatDateKey, formatStreamLine } from "../dashboard/stream-format.js";
import { runRelaunch } from "./relaunch.js";
import { HEARTBEAT_STALE_MS } from "../constants.js";
import {
  appendHistoryEntry,
  loadCommandHistory,
  saveCommandHistory,
} from "../state/command-history.js";
import {
  filterSlashCommands,
  formatSlashCommandList,
  getSlashCompletions,
  parseSlashInput,
  type SlashCommandDefinition,
} from "./slash-commands.js";
import { createReadStream, watch } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as readline from "node:readline";
import { buildBasePrompt, ClankerRole } from "../prompting/role-prompts.js";

const COMMAND_HISTORY_LIMIT = 50;
const STREAM_LIMIT = 200;
const PAUSE_RETRY_MS = 1000;
const PLANNER_PROMPT_TIMEOUT_MS = 120_000;

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
} as const;

type CommandHandler = (value: string) => void;

interface CodexPaneState {
  hasPrompt: boolean;
  isWorking: boolean;
  isPaused: boolean;
  hasEscalation: boolean;
}

interface PendingAction {
  kind: "pause" | "resume";
  role: ClankerRole;
  requestedAt: number;
  lastSentAt?: number;
}

interface ReadlineWithHistory extends readline.Interface {
  history: string[];
  output: NodeJS.WriteStream;
}

interface SlashCommandHandler extends SlashCommandDefinition {
  run: ({ args }: { args: string }) => Promise<string | null> | string | null;
}

const makeCommandPrompt = (): string => {
  return `${ANSI.gray}[/]${ANSI.reset} ${ANSI.cyan}/command${ANSI.reset} `;
};

const PROMPT_MARKER = /^\u203A/;
const WORKING_MATCH = "esc to interrupt";

export const runDashboard = async ({}: {}): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });
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
  let lastStatusLine = "";
  const promptSettings = getPromptSettings({ repoRoot, config });
  const knownTaskIds = new Set<string>();
  let lastDateKey: string | null = null;
  const pendingActions = new Map<string, PendingAction>();
  const basePromptSent = new Set<string>();
  const plannerDispatchState = {
    pending: false,
    sentAt: 0,
    taskCountAt: 0,
  };

  const commandHistory = await loadCommandHistory({
    path: paths.commandHistoryPath,
    maxEntries: COMMAND_HISTORY_LIMIT,
  });

  let slashCommands: SlashCommandHandler[] = [];
  const commandCompleter = (line: string): [string[], string] => {
    const { completions, completionBase } = getSlashCompletions({
      commands: slashCommands,
      input: line,
    });
    return [completions, completionBase];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: COMMAND_HISTORY_LIMIT,
    completer: commandCompleter,
  }) as ReadlineWithHistory;
  rl.setPrompt(makeCommandPrompt());
  rl.history = [...commandHistory].reverse();

  const clearPromptLine = (): void => {
    readline.clearLine(rl.output, 0);
    readline.cursorTo(rl.output, 0);
  };

  const writeLine = (line: string): void => {
    rl.pause();
    clearPromptLine();
    rl.output.write(`${line}\n`);
    rl.resume();
    rl.prompt(true);
  };

  const writeDividerIfNeeded = ({ date }: { date: Date }): void => {
    const dateKey = formatDateKey({ date });
    if (dateKey === lastDateKey) {
      return;
    }
    lastDateKey = dateKey;
    writeLine(formatDateDivider({ date }));
  };

  const renderEvent = ({ raw }: { raw: string }): void => {
    const line = raw.trim();
    if (!line) {
      return;
    }
    try {
      const event = JSON.parse(line) as ClankerEvent;
      if (event.taskId) {
        knownTaskIds.add(event.taskId);
      }
      const formatted = formatStreamLine({ event });
      if (!formatted) {
        return;
      }
      writeDividerIfNeeded({ date: formatted.date });
      writeLine(formatted.line);
    } catch {
      return;
    }
  };

  const writeCommandList = ({
    commands,
    title,
  }: {
    commands: SlashCommandDefinition[];
    title: string;
  }): void => {
    const lines = formatSlashCommandList({ commands });
    const content = [title, ...lines].join("\n");
    writeLine(content);
  };

  const parseRoleArg = ({
    args,
    commandName,
  }: {
    args: string;
    commandName: string;
  }): ClankerRole | "all" | null => {
    const token = args.trim().split(/\s+/)[0];
    if (!token) {
      return "all";
    }
    if (token === "planner") {
      return ClankerRole.Planner;
    }
    if (token === "judge") {
      return ClankerRole.Judge;
    }
    if (token === "slave") {
      return ClankerRole.Slave;
    }
    writeLine(`${ANSI.gray}usage: /${commandName} [planner|judge|slave]${ANSI.reset}`);
    return null;
  };

  slashCommands = [
    {
      name: "help",
      description: "list dashboard slash commands",
      usage: "/help",
      run: () => {
        writeCommandList({ commands: slashCommands, title: "commands:" });
        return "listed commands";
      },
    },
    {
      name: "resume",
      description: "resume queued work",
      usage: "/resume",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "resume" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: false, role });
        return "resumed work";
      },
    },
    {
      name: "pause",
      description: "pause new work",
      usage: "/pause",
      run: async ({ args }) => {
        const role = parseRoleArg({ args, commandName: "pause" });
        if (!role) {
          return null;
        }
        await setPaused({ paused: true, role });
        return "paused work";
      },
    },
    {
      name: "focus",
      description: "toggle focus to last active slave pane",
      usage: "/focus",
      run: async () => {
        await toggleFocus();
        return "toggled focus";
      },
    },
    {
      name: "relaunch",
      description: "relaunch codex agents",
      usage: "/relaunch [--fresh] [target]",
      run: async ({ args }) => {
        const parts = args.length > 0 ? args.split(/\s+/) : [];
        await runRelaunch({ args: parts, log: (message) => writeLine(message) });
        return "relaunch requested";
      },
    },
    {
      name: "task",
      description: "set a task status",
      usage: "/task <id> <status>",
      run: async ({ args }) => {
        const [id, status] = args.split(/\s+/);
        if (!id || !status) {
          writeLine(`${ANSI.gray}usage: /task <id> <status>${ANSI.reset}`);
          return null;
        }
        if (!TASK_SCHEMA.status.includes(status)) {
          writeLine(`${ANSI.gray}invalid status: ${status}${ANSI.reset}`);
          return null;
        }
        const task = await loadTask({ tasksDir: paths.tasksDir, id });
        if (!task) {
          writeLine(`${ANSI.gray}task not found: ${id}${ANSI.reset}`);
          return null;
        }
        await transitionTaskStatus({ task, status: status as typeof task.status, paths });
        return `task ${id} -> ${status}`;
      },
    },
  ];

  const handleCommand: CommandHandler = (raw) => {
    const value = raw.trim();
    if (!value) {
      return;
    }
    const parsed = parseSlashInput({ input: value });
    if (!parsed.hasLeadingSlash) {
      writeLine(`${ANSI.gray}commands must start with '/'${ANSI.reset}`);
      return;
    }

    const nextHistory = appendHistoryEntry({
      entries: commandHistory,
      entry: value,
      maxEntries: COMMAND_HISTORY_LIMIT,
    });
    commandHistory.splice(0, commandHistory.length, ...nextHistory);
    rl.history = [...commandHistory].reverse();
    void saveCommandHistory({
      path: paths.commandHistoryPath,
      entries: commandHistory,
      maxEntries: COMMAND_HISTORY_LIMIT,
    });

    if (parsed.name.length === 0) {
      writeCommandList({ commands: slashCommands, title: "commands:" });
      return;
    }
    const { exact, matches } = filterSlashCommands({
      commands: slashCommands,
      token: parsed.name,
    });

    if (!exact || exact.name.toLowerCase() !== parsed.name.toLowerCase()) {
      if (matches.length > 0) {
        writeCommandList({ commands: matches, title: `matches for /${parsed.name}:` });
      } else {
        writeLine(`${ANSI.gray}unknown command: /${parsed.name}${ANSI.reset}`);
      }
      return;
    }

    const runArgs = parsed.rest.trim();
    const commandLabel = runArgs.length > 0 ? `/${exact.name} ${runArgs}` : `/${exact.name}`;
    Promise.resolve(exact.run({ args: runArgs }))
      .then((result) => {
        if (!result) {
          return;
        }
        writeLine(`${ANSI.gray}ran ${commandLabel} (${result})${ANSI.reset}`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writeLine(`${ANSI.gray}command failed: ${message}${ANSI.reset}`);
      });
  };

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

  const setPaused = async ({
    paused,
    role,
  }: {
    paused: boolean;
    role: ClankerRole | "all";
  }): Promise<void> => {
    const current = await loadState({ statePath: paths.statePath });
    if (role === "all") {
      if (current.paused === paused && !paused) {
        current.pausedRoles = {
          planner: false,
          judge: false,
          slave: false,
        };
      } else {
        current.paused = paused;
        if (!paused) {
          current.pausedRoles = {
            planner: false,
            judge: false,
            slave: false,
          };
        }
      }
    } else {
      const key =
        role === ClankerRole.Planner ? "planner" : role === ClankerRole.Judge ? "judge" : "slave";
      if (current.pausedRoles[key] === paused) {
        return;
      }
      current.pausedRoles[key] = paused;
    }
    await saveState({ statePath: paths.statePath, state: current });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: paused ? "PAUSED" : "RESUMED",
        msg:
          role === "all"
            ? paused
              ? "paused all work"
              : "resumed work"
            : paused
              ? `paused ${role}`
              : `resumed ${role}`,
      },
    });
    const panes = await listPanes({ sessionName: config.tmuxFilter });
    const plannerPanes = panes.filter((pane) =>
      ["clanker:planner", "planner"].includes(pane.title),
    );
    const judgePanes = panes.filter((pane) => ["clanker:judge", "judge"].includes(pane.title));
    const slavePanes = panes.filter((pane) => /^clanker:c\d+$/.test(pane.title));
    const queueForPane = ({
      paneId,
      actionRole,
    }: {
      paneId: string;
      actionRole: ClankerRole;
    }): void => {
      pendingActions.set(paneId, {
        kind: paused ? "pause" : "resume",
        role: actionRole,
        requestedAt: Date.now(),
      });
    };
    const queueRole = ({
      actionRole,
      targets,
    }: {
      actionRole: ClankerRole;
      targets: typeof panes;
    }) => {
      for (const pane of targets) {
        queueForPane({ paneId: pane.paneId, actionRole });
      }
    };
    if (role === "all") {
      queueRole({ actionRole: ClankerRole.Planner, targets: plannerPanes });
      queueRole({ actionRole: ClankerRole.Judge, targets: judgePanes });
      queueRole({ actionRole: ClankerRole.Slave, targets: slavePanes });
      return;
    }
    if (role === ClankerRole.Planner) {
      queueRole({ actionRole: ClankerRole.Planner, targets: plannerPanes });
      return;
    }
    if (role === ClankerRole.Judge) {
      queueRole({ actionRole: ClankerRole.Judge, targets: judgePanes });
      return;
    }
    queueRole({ actionRole: ClankerRole.Slave, targets: slavePanes });
  };

  const ensureEventsLog = async (): Promise<void> => {
    try {
      await stat(paths.eventsLog);
    } catch {
      await writeFile(paths.eventsLog, "", "utf-8");
    }
  };

  const backfillTaskPackets = async (): Promise<void> => {
    const tasks = await listTasks({ tasksDir: paths.tasksDir });
    for (const task of tasks) {
      if (knownTaskIds.has(task.id)) {
        continue;
      }
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
  };

  const startEventStream = async (): Promise<(() => void) | null> => {
    await ensureEventsLog();
    try {
      const raw = await readFile(paths.eventsLog, "utf-8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { taskId?: string };
          if (event.taskId) {
            knownTaskIds.add(event.taskId);
          }
        } catch {
          continue;
        }
      }
      const recent = lines.slice(-STREAM_LIMIT);
      for (const line of recent) {
        renderEvent({ raw: line });
      }
    } catch {
      return null;
    }

    let offset = 0;
    try {
      const raw = await readFile(paths.eventsLog, "utf-8");
      offset = Buffer.from(raw).length;
    } catch {
      offset = 0;
    }

    const watcher = watch(paths.eventsLog, async (eventType) => {
      if (eventType !== "change") {
        return;
      }
      try {
        const stats = await stat(paths.eventsLog);
        if (stats.size <= offset) {
          return;
        }
        const stream = createReadStream(paths.eventsLog, { start: offset, end: stats.size - 1 });
        let chunked = "";
        stream.on("data", (chunk) => {
          chunked += chunk.toString();
        });
        stream.on("end", () => {
          const chunkLines = chunked
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          for (const line of chunkLines) {
            renderEvent({ raw: line });
          }
          offset = stats.size;
        });
      } catch {
        return;
      }
    });

    return () => watcher.close();
  };

  const escalationPromptMatches = [
    "Would you like to run the following command?",
    "Press enter to confirm",
  ];

  const hasEscalationPrompt = ({ content }: { content: string }): boolean =>
    escalationPromptMatches.some((pattern) => content.includes(pattern));

  const inspectCodexPane = async ({ paneId }: { paneId: string }): Promise<CodexPaneState> => {
    const content = await capturePane({ paneId, lines: 80 });
    const lines = content.split("\n");
    const hasPrompt = lines.some((line) => PROMPT_MARKER.test(line.trimStart()));
    const hasEscalation = hasEscalationPrompt({ content });
    const isWorking = lines.some(
      (line) => line.includes("Working") && line.toLowerCase().includes(WORKING_MATCH),
    );
    const isPaused = lines.some((line) => line.toLowerCase().includes("paused"));
    return { hasPrompt, isWorking, isPaused, hasEscalation };
  };

  const shouldSendAction = ({ action }: { action: PendingAction }): boolean => {
    if (!action.lastSentAt) {
      return true;
    }
    return Date.now() - action.lastSentAt > PAUSE_RETRY_MS;
  };

  const processPendingActions = async (): Promise<void> => {
    for (const [paneId, action] of pendingActions) {
      const state = await inspectCodexPane({ paneId });
      if (action.kind === "pause") {
        if (state.hasEscalation) {
          continue;
        }
        if (state.isPaused || !state.isWorking) {
          pendingActions.delete(paneId);
          continue;
        }
        if (shouldSendAction({ action })) {
          await sendKey({ paneId, key: "Escape" });
          pendingActions.set(paneId, { ...action, lastSentAt: Date.now() });
        }
        continue;
      }
      if (!state.isPaused) {
        pendingActions.delete(paneId);
        continue;
      }
      if (shouldSendAction({ action })) {
        await sendKey({ paneId, key: "Escape" });
        pendingActions.set(paneId, { ...action, lastSentAt: Date.now() });
      }
    }
  };

  const maybeSendBasePrompt = async ({
    paneId,
    role,
  }: {
    paneId: string;
    role: ClankerRole;
  }): Promise<void> => {
    if (basePromptSent.has(paneId)) {
      return;
    }
    const state = await inspectCodexPane({ paneId });
    if (state.hasEscalation || state.isWorking || !state.hasPrompt) {
      return;
    }
    const prompt = buildBasePrompt({ role });
    await sendKeys({ paneId, text: prompt });
    basePromptSent.add(paneId);
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "BASE_PROMPT",
        msg: `base prompt sent (${role})`,
        slaveId: role,
      },
    });
  };

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
    const extractSlaveId = ({ title }: { title: string }): string | null => {
      const normalized = title.startsWith("clanker:") ? title.replace("clanker:", "") : title;
      return /^c\d+$/.test(normalized) ? normalized : null;
    };
    const plannerPanes = panes.filter((pane) =>
      ["clanker:planner", "planner"].includes(pane.title),
    );
    const judgePanes = panes.filter((pane) => ["clanker:judge", "judge"].includes(pane.title));
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
    if (currentPane && currentPane !== dashboardPaneId) {
      const isSlavePane = slavePanes.some((entry) => entry.pane.paneId === currentPane);
      if (isSlavePane) {
        lastSlavePaneId = currentPane;
      }
    }
    if (!lastSlavePaneId && slavePanes.length > 0) {
      lastSlavePaneId = slavePanes[0]?.pane.paneId ?? null;
    }

    const plannerRolePaused = liveState.paused || liveState.pausedRoles.planner;
    const judgeRolePaused = liveState.paused || liveState.pausedRoles.judge;
    const slaveRolePaused = liveState.paused || liveState.pausedRoles.slave;

    if (!plannerRolePaused) {
      for (const pane of plannerPanes) {
        await maybeSendBasePrompt({ paneId: pane.paneId, role: ClankerRole.Planner });
      }
    }
    if (!judgeRolePaused) {
      for (const pane of judgePanes) {
        await maybeSendBasePrompt({ paneId: pane.paneId, role: ClankerRole.Judge });
      }
    }
    if (!slaveRolePaused) {
      for (const entry of slavePanes) {
        await maybeSendBasePrompt({ paneId: entry.pane.paneId, role: ClankerRole.Slave });
      }
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

    await processPendingActions();

    const heartbeats = await readHeartbeats({ heartbeatDir: paths.heartbeatDir });
    const nowMs = Date.now();
    const staleThresholdMs = HEARTBEAT_STALE_MS;
    const staleCount = heartbeats.filter((hb) =>
      isHeartbeatStale({ heartbeat: hb, nowMs, thresholdMs: staleThresholdMs }),
    ).length;
    const nextStale = new Set<string>();
    for (const hb of heartbeats) {
      if (isHeartbeatStale({ heartbeat: hb, nowMs, thresholdMs: staleThresholdMs })) {
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
    if (plannerDispatchState.pending) {
      if (tasks.length > plannerDispatchState.taskCountAt) {
        plannerDispatchState.pending = false;
      } else if (Date.now() - plannerDispatchState.sentAt > PLANNER_PROMPT_TIMEOUT_MS) {
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
        .filter((slaveId) => !staleSlaves.has(slaveId));

      const assigned = await assignQueuedTasks({
        tasks,
        availableSlaves,
        paths,
        staleSlaves,
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
      `escalation=${pendingEscalationPaneId ? "pending" : "none"}`,
      `hb=${heartbeats.length}`,
      `stale=${staleCount}`,
    ].join(" ");
    if (statusLine !== lastStatusLine) {
      lastStatusLine = statusLine;
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
      idleStartedAt = Date.now();
    }
    const idleMinutes = Math.floor((Date.now() - idleStartedAt) / (60 * 1000));

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

  dashboardPaneId = await getCurrentPaneId();

  writeLine(`clanker dashboard v${version} (native scroll)`);
  writeLine(`planners:${config.planners} judges:${config.judges} slaves:${config.slaves}`);

  const stopStream = await startEventStream();
  await backfillTaskPackets();

  rl.on("line", (value) => {
    handleCommand(value);
    rl.prompt();
  });
  rl.on("SIGINT", () => {
    process.emit("SIGINT", "SIGINT");
  });

  await tick();
  const interval = setInterval(() => {
    void tick();
  }, 1000);

  const shutdown = (): void => {
    clearInterval(interval);
    rl.close();
    if (stopStream) {
      stopStream();
    }
  };

  process.on("SIGINT", () => {
    shutdown();
  });
  process.on("SIGTERM", () => {
    shutdown();
  });

  rl.prompt();
};
