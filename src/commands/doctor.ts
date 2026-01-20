import { access } from "node:fs/promises";
import { getClankerPaths } from "../paths.js";
import { ensureStateDirs } from "../state/ensure-state.js";

const checkPath = async ({ label, path }: { label: string; path: string }): Promise<string> => {
  try {
    await access(path);
    return `ok ${label}`;
  } catch {
    return `missing ${label}`;
  }
};

export const runDoctor = async ({ args }: { args: string[] }): Promise<void> => {
  const repoRoot = process.cwd();
  const paths = getClankerPaths({ repoRoot });
  const shouldFix = args.includes("--fix");
  if (shouldFix) {
    await ensureStateDirs({ paths });
  }

  const checks = await Promise.all([
    checkPath({ label: ".clanker", path: paths.stateDir }),
    checkPath({ label: ".clanker/state.json", path: paths.statePath }),
    checkPath({ label: ".clanker/tasks", path: paths.tasksDir }),
    checkPath({ label: ".clanker/history", path: paths.historyDir }),
    checkPath({ label: ".clanker/heartbeat", path: paths.heartbeatDir }),
    checkPath({ label: ".clanker/logs", path: paths.logsDir }),
    checkPath({ label: ".clanker/archive/tasks", path: paths.archiveTasksDir }),
  ]);

  for (const line of checks) {
    console.log(line);
  }
};
