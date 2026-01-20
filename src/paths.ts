import { join } from "node:path";

export interface ClankerPaths {
  repoRoot: string;
  stateDir: string;
  eventsLog: string;
  statePath: string;
  tasksDir: string;
  historyDir: string;
  heartbeatDir: string;
  metricsPath: string;
  logsDir: string;
  archiveDir: string;
  archiveTasksDir: string;
}

export const getClankerPaths = ({ repoRoot }: { repoRoot: string }): ClankerPaths => {
  const stateDir = join(repoRoot, ".clanker");
  return {
    repoRoot,
    stateDir,
    eventsLog: join(stateDir, "events.log"),
    statePath: join(stateDir, "state.json"),
    tasksDir: join(stateDir, "tasks"),
    historyDir: join(stateDir, "history"),
    heartbeatDir: join(stateDir, "heartbeat"),
    metricsPath: join(stateDir, "metrics.json"),
    logsDir: join(stateDir, "logs"),
    archiveDir: join(stateDir, "archive"),
    archiveTasksDir: join(stateDir, "archive", "tasks"),
  };
};
