import { loadConfig } from "../config.js";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";
import { appendEvent } from "../state/events.js";
import { writeHeartbeat } from "../state/heartbeat.js";
import { spawnCodex } from "./spawn-codex.js";

const parseSlaveId = ({ idRaw }: { idRaw: string | undefined }): string => {
  if (!idRaw) {
    throw new Error("Missing slave id (expected: clanker slave <n>)");
  }
  return `c${idRaw}`;
};

export const runSlave = async ({ idRaw }: { idRaw: string | undefined }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  await ensureStateDirs({ paths });
  const config = await loadConfig({ repoRoot });

  const slaveId = parseSlaveId({ idRaw });
  console.log(`clanker slave ${slaveId} (slaves=${config.slaves})`);

  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "SLAVE_READY",
      msg: "waiting for assignments",
      slaveId,
    },
  });

  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat({ heartbeatDir: paths.heartbeatDir, slaveId });
  }, 10_000);

  const { child, logPath } = await spawnCodex({
    logsDir: paths.logsDir,
    role: "slave",
    id: slaveId,
    command: config.codexCommand,
  });
  await appendEvent({
    eventsLog: paths.eventsLog,
    event: {
      ts: new Date().toISOString(),
      type: "CHAT_LOG",
      msg: `logging to ${logPath}`,
      slaveId,
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
