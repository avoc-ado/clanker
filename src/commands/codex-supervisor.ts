import { loadConfig } from "../config.js";
import { inspectCodexPane } from "../dashboard/pending-actions.js";
import type { ClankerPaths } from "../paths.js";
import { appendEvent } from "../state/events.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { loadState } from "../state/state.js";
import { capturePane, listPanes, sendKeys } from "../tmux.js";
import { spawnCodex } from "./spawn-codex.js";
import { extractResumeCommand } from "../codex/resume.js";
import { getRelaunchPrompt } from "./relaunch-prompt.js";
import { RELAUNCH_SIGNALS, type RelaunchMode } from "../constants.js";
import { sendIpcRequest } from "../ipc/client.js";
import { getRuntimeOverrides } from "../runtime/overrides.js";

const IPC_POLL_MS = 2_000;
const ESCALATION_PROMPT_MATCHES = [
  "Would you like to run the following command?",
  "Press enter to confirm",
];

const hasEscalationPrompt = ({ content }: { content: string }): boolean =>
  ESCALATION_PROMPT_MATCHES.some((pattern) => content.includes(pattern));

export const runCodexSupervisor = async ({
  paths,
  role,
  id,
  command,
  cwd,
  readyEvent,
  statusLine,
}: {
  paths: ClankerPaths;
  role: "planner" | "judge" | "slave";
  id: string;
  command?: string;
  cwd?: string;
  readyEvent: { type: string; msg: string };
  statusLine?: string;
}): Promise<void> => {
  if (statusLine) {
    console.log(statusLine);
  }
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: readyEvent.type,
      msg: readyEvent.msg,
      slaveId: id,
    },
  });

  let activeChild: Awaited<ReturnType<typeof spawnCodex>>["child"] | null = null;
  let activeLogPath = "";
  let shuttingDown = false;
  let pendingRelaunch: RelaunchMode | null = null;
  let lastPaneSnapshot = "";
  let lastPaneActivityAt = 0;

  const heartbeatTimer = setInterval(() => {
    const payload = {
      podId: id,
      pid: process.pid,
      role,
      ts: new Date().toISOString(),
    };
    const socketPath = process.env.CLANKER_IPC_SOCKET?.trim();
    if (socketPath) {
      void sendIpcRequest({
        socketPath,
        type: "heartbeat",
        payload,
      }).catch(() => {
        void writeHeartbeat({
          heartbeatDir: paths.heartbeatDir,
          slaveId: id,
          pid: process.pid,
          role,
        });
      });
      return;
    }
    void writeHeartbeat({
      heartbeatDir: paths.heartbeatDir,
      slaveId: id,
      pid: process.pid,
      role,
    });
  }, 10_000);

  const ipcSocket = process.env.CLANKER_IPC_SOCKET?.trim() ?? "";
  const isIpcRequester = ipcSocket.length > 0 && (role === "slave" || role === "judge");
  const overrides = getRuntimeOverrides();
  const isCodexTty = Boolean(overrides.codexTty);
  if (role !== "planner") {
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "IPC_INIT",
        msg: isIpcRequester ? "ipc polling enabled" : "ipc polling disabled (missing socket)",
        slaveId: id,
      },
    });
  }
  let ipcPollInFlight = false;
  let cachedTmuxFilter: string | undefined;
  const resolveTmuxFilter = async (): Promise<string | undefined> => {
    if (cachedTmuxFilter !== undefined) {
      return cachedTmuxFilter;
    }
    const config = await loadConfig({ repoRoot: paths.repoRoot });
    cachedTmuxFilter = config.tmuxFilter;
    return cachedTmuxFilter;
  };
  const findPaneIdForRole = async (): Promise<string | null> => {
    const sessionPrefix = await resolveTmuxFilter();
    const panes = await listPanes({ sessionPrefix });
    const match = panes.find((pane) => pane.title === `clanker:${id}` || pane.title === id);
    return match?.paneId ?? null;
  };
  const requestIpcPrompt = async (): Promise<void> => {
    if (!isIpcRequester || ipcPollInFlight || shuttingDown) {
      return;
    }
    ipcPollInFlight = true;
    try {
      const paneId = isCodexTty ? await findPaneIdForRole() : null;
      if (isCodexTty && !paneId) {
        return;
      }
      if (!isCodexTty) {
        const child = activeChild;
        if (!child?.stdin?.writable) {
          return;
        }
      }
      const state = await loadState({ statePath: paths.statePath });
      const isRolePaused = role === "judge" ? state.pausedRoles.judge : state.pausedRoles.slave;
      if (state.paused || isRolePaused) {
        return;
      }
      const nowMs = Date.now();
      const paneState = paneId
        ? await inspectCodexPane({ paneId, capturePane, hasEscalationPrompt })
        : null;
      if (paneState) {
        if (paneState.isWorking || paneState.hasEscalation || !paneState.hasPrompt) {
          return;
        }
        if (paneState.content) {
          if (paneState.content !== lastPaneSnapshot) {
            lastPaneSnapshot = paneState.content;
            lastPaneActivityAt = nowMs;
          }
          if (lastPaneActivityAt > 0 && nowMs - lastPaneActivityAt < 30_000) {
            return;
          }
        }
      }
      const type = role === "judge" ? "judge_request" : "task_request";
      const response = await sendIpcRequest({
        socketPath: ipcSocket,
        type,
        payload: { podId: id },
      });
      if (!response.ok) {
        return;
      }
      const data = response.data as { taskId?: string | null; prompt?: string } | undefined;
      if (!data?.taskId || !data.prompt) {
        return;
      }
      if (isCodexTty && paneId) {
        await sendKeys({ paneId, text: data.prompt });
        return;
      }
      if (activeChild?.stdin?.writable) {
        activeChild.stdin.write(`${data.prompt}\n`);
      }
    } catch {
      // ignore ipc polling errors; fallback is dashboard-driven prompting
    } finally {
      ipcPollInFlight = false;
    }
  };
  const ipcTimer = isIpcRequester
    ? setInterval(() => {
        void requestIpcPrompt();
      }, IPC_POLL_MS)
    : null;
  ipcTimer?.unref?.();
  const clearTimers = (): void => {
    clearInterval(heartbeatTimer);
    if (ipcTimer) {
      clearInterval(ipcTimer);
    }
  };

  const startCodex = async ({
    override,
    autoContinue,
    promptText,
    promptMeta,
  }: {
    override?: string;
    autoContinue?: boolean;
    promptText?: string | null;
    promptMeta?: { kind: string; taskId?: string } | null;
  }): Promise<void> => {
    const { child, logPath } = await spawnCodex({
      logsDir: paths.logsDir,
      role,
      id,
      command: override ?? command,
      cwd,
    });
    activeChild = child;
    activeLogPath = logPath;
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "CHAT_LOG",
        msg: `logging to ${logPath}`,
        slaveId: id,
        data: { path: logPath },
      },
    });
    child.on("exit", (code) => {
      void handleExit({ code });
    });
    if (promptText && promptText.trim().length > 0) {
      await appendEvent({
        eventsLog: paths.eventsLog,
        event: {
          ts: new Date().toISOString(),
          type: "CODEX_RELAUNCH_PROMPT",
          msg: "sent relaunch prompt",
          slaveId: id,
          taskId: promptMeta?.taskId,
          data: promptMeta?.kind ? { kind: promptMeta.kind } : undefined,
        },
      });
      setTimeout(() => {
        if (activeChild?.stdin?.writable) {
          activeChild.stdin.write(`${promptText}\n`);
        }
      }, 500);
      return;
    }
    if (autoContinue) {
      setTimeout(() => {
        if (activeChild?.stdin?.writable) {
          activeChild.stdin.write("continue\n");
        }
      }, 500);
    }
  };

  const handleExit = async ({ code }: { code: number | null }): Promise<void> => {
    if (shuttingDown) {
      clearTimers();
      process.exit(code ?? 0);
    }
    if (!pendingRelaunch) {
      clearTimers();
      process.exit(code ?? 0);
    }
    const relaunchMode = pendingRelaunch;
    pendingRelaunch = null;
    const resumeCommand =
      relaunchMode === "resume" ? await extractResumeCommand({ logPath: activeLogPath }) : null;
    const state = await loadState({ statePath: paths.statePath });
    const shouldAutoContinue = Boolean(resumeCommand) && !state.paused;
    const freshPrompt =
      relaunchMode === "fresh" && !state.paused
        ? await getRelaunchPrompt({ paths, role, id })
        : null;
    await appendEvent({
      eventsLog: paths.eventsLog,
      event: {
        ts: new Date().toISOString(),
        type: "CODEX_RELAUNCH",
        msg: resumeCommand ? "relaunch with resume" : "relaunch fresh",
        slaveId: id,
        data: {
          ...(resumeCommand ? { command: resumeCommand } : {}),
          ...(freshPrompt?.kind ? { promptKind: freshPrompt.kind } : {}),
          ...(freshPrompt?.taskId ? { taskId: freshPrompt.taskId } : {}),
        },
      },
    });
    await startCodex({
      override: resumeCommand ?? command,
      autoContinue: shouldAutoContinue,
      promptText: freshPrompt?.text,
      promptMeta: freshPrompt ? { kind: freshPrompt.kind, taskId: freshPrompt.taskId } : null,
    });
  };

  const requestRelaunch = ({ mode }: { mode: RelaunchMode }): void => {
    pendingRelaunch = mode;
    activeChild?.kill("SIGINT");
  };

  process.on(RELAUNCH_SIGNALS.fresh, () => {
    requestRelaunch({ mode: "fresh" });
  });
  process.on(RELAUNCH_SIGNALS.resume, () => {
    requestRelaunch({ mode: "resume" });
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
    activeChild?.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
    activeChild?.kill("SIGTERM");
  });

  await startCodex({});
};
