import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { loadState, saveState } from "../state/state.js";
import type { PromptApprovalRequest, PromptAutoApprove } from "../state/state.js";
import { capturePane, getCurrentPaneId, listPanes, selectPane, sendKeys } from "../tmux.js";
import { appendEvent } from "../state/events.js";
import { getPromptSettings } from "../prompting.js";
import { formatDateDivider, formatDateKey, formatStreamLine } from "../dashboard/stream-format.js";
import { runRelaunch } from "./relaunch.js";
import { loadCommandHistory } from "../state/command-history.js";
import { getSlashCompletions } from "./slash-commands.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as readline from "node:readline";
import { ClankerRole } from "../prompting/role-prompts.js";
import { getRepoRoot } from "../repo-root.js";
import {
  buildDashboardCommands,
  makeDashboardCommandHandler,
  type SlashCommandHandler,
} from "../dashboard/dashboard-commands.js";
import { backfillTaskPackets, startEventStream } from "../dashboard/event-stream.js";
import { inspectCodexPane, type PendingAction } from "../dashboard/pending-actions.js";
import {
  makeDashboardTick,
  type DashboardTickState,
  type PlannerDispatchState,
} from "../dashboard/dashboard-tick.js";
import { extractSlaveId, parseJudgeTitle, parsePlannerTitle } from "../tmux-title-utils.js";

const COMMAND_HISTORY_LIMIT = 50;
const STREAM_LIMIT = 200;
const PAUSE_RETRY_MS = 1000;
const PLANNER_PROMPT_TIMEOUT_MS = 120_000;

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
} as const;

interface ReadlineWithHistory extends readline.Interface {
  history: string[];
  output: NodeJS.WriteStream;
}

const makeCommandPrompt = (): string => {
  return `${ANSI.gray}[/]${ANSI.reset} ${ANSI.cyan}/command${ANSI.reset} `;
};

export const runDashboard = async ({}: {}): Promise<void> => {
  const repoRoot = getRepoRoot();
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

  const dashboardState: DashboardTickState = {
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
  };
  const promptSettings = getPromptSettings({ repoRoot, config });
  const knownTaskIds = new Set<string>();
  let lastDateKey: string | null = null;
  const pendingActions = new Map<string, PendingAction>();
  const plannerDispatchState: PlannerDispatchState = {
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
  const writeLines = (lines: string[]): void => {
    if (lines.length === 0) {
      return;
    }
    rl.pause();
    clearPromptLine();
    rl.output.write(`${lines.join("\n")}\n`);
    rl.resume();
    rl.prompt(true);
  };

  const formatCommandLine = (line: string): string => `${ANSI.gray}${line}${ANSI.reset}`;
  const writeCommandLine = (line: string): void => {
    writeLine(formatCommandLine(line));
  };
  const formatApprovalLines = ({ approval }: { approval: PromptApprovalRequest }): string[] => {
    const taskLabel = approval.taskId
      ? `${approval.taskId}${approval.taskTitle ? ` ${approval.taskTitle}` : ""}`
      : "";
    const headerParts = [
      `${ANSI.cyan}Approve prompt:${ANSI.reset}`,
      approval.role,
      taskLabel,
    ].filter((part) => part.length > 0);
    return [
      headerParts.join(" "),
      `${ANSI.gray}--- prompt ---${ANSI.reset}`,
      ...approval.prompt.split("\n"),
      `${ANSI.gray}--- end prompt ---${ANSI.reset}`,
      `${ANSI.cyan}Approve? (y/n)${ANSI.reset}`,
    ];
  };
  const loadApprovalState = async (): Promise<PromptAutoApprove> => {
    const current = await loadState({ statePath: paths.statePath });
    return current.promptApprovals.autoApprove;
  };
  const setAutoApprove = async ({
    role,
    enabled,
  }: {
    role: keyof PromptAutoApprove;
    enabled: boolean;
  }): Promise<void> => {
    const current = await loadState({ statePath: paths.statePath });
    const next = {
      ...current,
      promptApprovals: {
        ...current.promptApprovals,
        autoApprove: { ...current.promptApprovals.autoApprove, [role]: enabled },
      },
    };
    await saveState({ statePath: paths.statePath, state: next });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "PROMPT_AUTO_APPROVE",
        msg: `auto-approve ${enabled ? "on" : "off"} for ${role}`,
      },
    });
  };
  const getNextApproval = async (): Promise<PromptApprovalRequest | null> => {
    const current = await loadState({ statePath: paths.statePath });
    if (current.promptApprovals.approved) {
      return null;
    }
    return current.promptApprovals.queue[0] ?? null;
  };
  const maybePromptForApproval = async (): Promise<void> => {
    const approval = await getNextApproval();
    if (!approval) {
      dashboardState.lastApprovalId = null;
      return;
    }
    if (dashboardState.lastApprovalId === approval.id) {
      return;
    }
    dashboardState.lastApprovalId = approval.id;
    writeLines(formatApprovalLines({ approval }));
  };
  const resolveApproval = async ({ approved }: { approved: boolean }): Promise<void> => {
    const current = await loadState({ statePath: paths.statePath });
    if (current.promptApprovals.approved) {
      writeLine(formatCommandLine("prompt already approved; waiting on send"));
      return;
    }
    const nextApproval = current.promptApprovals.queue[0];
    if (!nextApproval) {
      writeLine(formatCommandLine("no prompt awaiting approval"));
      return;
    }
    const remainingQueue = current.promptApprovals.queue.slice(1);
    const nextState = {
      ...current,
      promptApprovals: {
        ...current.promptApprovals,
        queue: remainingQueue,
        approved: approved ? nextApproval : null,
      },
    };
    await saveState({ statePath: paths.statePath, state: nextState });
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: approved ? "PROMPT_APPROVED" : "PROMPT_DENIED",
        msg: approved ? "prompt approved" : "prompt denied",
        taskId: nextApproval.taskId,
        slaveId: nextApproval.assignedSlaveId,
        data: { kind: nextApproval.kind },
      },
    });
    dashboardState.lastApprovalId = null;
    if (!approved) {
      await maybePromptForApproval();
    }
    void tick();
  };

  const writeDividerIfNeeded = ({ date }: { date: Date }): void => {
    const dateKey = formatDateKey({ date });
    if (dateKey === lastDateKey) {
      return;
    }
    lastDateKey = dateKey;
    writeLine(formatDateDivider({ date }));
  };

  const toggleFocus = async (): Promise<void> => {
    if (!dashboardState.dashboardPaneId) {
      return;
    }
    const current = await getCurrentPaneId();
    if (current === dashboardState.dashboardPaneId) {
      if (dashboardState.lastSlavePaneId) {
        await selectPane({ paneId: dashboardState.lastSlavePaneId });
      }
      return;
    }
    await selectPane({ paneId: dashboardState.dashboardPaneId });
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
    const panes = await listPanes({ sessionPrefix: config.tmuxFilter });
    const plannerPanes = panes.filter((pane) => Boolean(parsePlannerTitle({ title: pane.title })));
    const judgePanes = panes.filter((pane) => Boolean(parseJudgeTitle({ title: pane.title })));
    const slavePanes = panes.filter((pane) => Boolean(extractSlaveId({ title: pane.title })));
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

  const runRelaunchCommand = async ({ args }: { args: string[] }): Promise<void> => {
    await runRelaunch({ args, log: (message) => writeLine(message) });
  };

  slashCommands = buildDashboardCommands({
    paths,
    writeLine: writeCommandLine,
    setPaused,
    toggleFocus,
    runRelaunch: runRelaunchCommand,
    getAutoApprove: loadApprovalState,
    setAutoApprove,
  });

  const handleCommand = makeDashboardCommandHandler({
    commands: slashCommands,
    commandHistory,
    commandHistoryPath: paths.commandHistoryPath,
    maxEntries: COMMAND_HISTORY_LIMIT,
    writeLine,
    onHistoryUpdated: (history) => {
      rl.history = [...history].reverse();
    },
    formatLine: formatCommandLine,
  });

  const escalationPromptMatches = [
    "Would you like to run the following command?",
    "Press enter to confirm",
  ];

  const hasEscalationPrompt = ({ content }: { content: string }): boolean =>
    escalationPromptMatches.some((pattern) => content.includes(pattern));

  const inspectPane = ({ paneId }: { paneId: string }) =>
    inspectCodexPane({ paneId, capturePane, hasEscalationPrompt });

  const tick = makeDashboardTick({
    repoRoot,
    config,
    paths,
    promptSettings,
    knownTaskIds,
    pendingActions,
    plannerDispatchState,
    state: dashboardState,
    inspectPane,
    pauseRetryMs: PAUSE_RETRY_MS,
    plannerPromptTimeoutMs: PLANNER_PROMPT_TIMEOUT_MS,
  });

  dashboardState.dashboardPaneId = await getCurrentPaneId();

  writeLine(`clanker dashboard v${version} (native scroll)`);
  writeLine(`planners:${config.planners} judges:${config.judges} slaves:${config.slaves}`);

  const stopStream = await startEventStream({
    eventsLog: paths.eventsLog,
    streamLimit: STREAM_LIMIT,
    knownTaskIds,
    writeDividerIfNeeded,
    writeLine,
    formatStreamLine,
  });
  await backfillTaskPackets({ tasksDir: paths.tasksDir, knownTaskIds, eventsLog: paths.eventsLog });

  rl.on("line", async (value) => {
    const trimmed = value.trim();
    if (trimmed.startsWith("/")) {
      handleCommand(value);
      rl.prompt();
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (["y", "yes", "n", "no"].includes(normalized)) {
      await resolveApproval({ approved: normalized === "y" || normalized === "yes" });
      rl.prompt();
      return;
    }
    handleCommand(value);
    rl.prompt();
  });
  rl.on("SIGINT", () => {
    process.emit("SIGINT", "SIGINT");
  });

  await tick();
  await maybePromptForApproval();
  const interval = setInterval(() => {
    void tick();
    void maybePromptForApproval();
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
