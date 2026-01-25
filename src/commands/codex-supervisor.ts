import type { ClankerPaths } from "../paths.js";
import { appendEvent } from "../state/events.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { loadState } from "../state/state.js";
import { spawnCodex } from "./spawn-codex.js";
import { extractResumeCommand } from "../codex/resume.js";
import { getRelaunchPrompt } from "./relaunch-prompt.js";
import { RELAUNCH_SIGNALS, type RelaunchMode } from "../constants.js";

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

  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat({
      heartbeatDir: paths.heartbeatDir,
      slaveId: id,
      pid: process.pid,
      role,
    });
  }, 10_000);

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
      clearInterval(heartbeatTimer);
      process.exit(code ?? 0);
    }
    if (!pendingRelaunch) {
      clearInterval(heartbeatTimer);
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
