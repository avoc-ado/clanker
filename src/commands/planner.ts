import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { spawnCodex } from "./spawn-codex.js";
import { loadConfig } from "../config.js";

export const runPlanner = async (): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const plannerId = "planner";
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "PLANNER_READY",
      msg: "planner ready",
      slaveId: plannerId,
    },
  });

  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat({ heartbeatDir: paths.heartbeatDir, slaveId: plannerId });
  }, 10_000);

  const { child, logPath } = await spawnCodex({
    logsDir: paths.logsDir,
    role: "planner",
    id: plannerId,
    command: config.codexCommand,
  });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "CHAT_LOG",
      msg: `logging to ${logPath}`,
      slaveId: plannerId,
      data: { path: logPath },
    },
  });
  child.on("exit", (code) => {
    clearInterval(heartbeatTimer);
    process.exit(code ?? 0);
  });
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });
};
