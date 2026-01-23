import { mkdir, stat, writeFile } from "node:fs/promises";
import type { ClankerPaths } from "../paths.js";
import { DEFAULT_STATE } from "./state.js";

export const ensureStateDirs = async ({ paths }: { paths: ClankerPaths }): Promise<void> => {
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(paths.tasksDir, { recursive: true });
  await mkdir(paths.historyDir, { recursive: true });
  await mkdir(paths.heartbeatDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.locksDir, { recursive: true });
  await mkdir(paths.archiveTasksDir, { recursive: true });
  try {
    await stat(paths.statePath);
  } catch {
    await writeFile(paths.statePath, JSON.stringify(DEFAULT_STATE, null, 2), "utf-8");
  }
};
