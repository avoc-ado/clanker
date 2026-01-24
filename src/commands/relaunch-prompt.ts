import type { ClankerPaths } from "../paths.js";
import { loadConfig } from "../config.js";
import {
  buildRelaunchPromptForJudge,
  buildRelaunchPromptForPlanner,
  buildRelaunchPromptForSlave,
  getPromptSettings,
  selectAssignedTask,
  type RelaunchPrompt,
} from "../prompting.js";
import { listTasks } from "../state/tasks.js";

export const getRelaunchPrompt = async ({
  paths,
  role,
  id,
}: {
  paths: ClankerPaths;
  role: "planner" | "judge" | "slave";
  id: string;
}): Promise<RelaunchPrompt | null> => {
  const config = await loadConfig({ repoRoot: paths.repoRoot });
  const promptSettings = getPromptSettings({ repoRoot: paths.repoRoot, config });
  if (role === "planner") {
    return buildRelaunchPromptForPlanner({ promptSettings });
  }

  const tasks = await listTasks({ tasksDir: paths.tasksDir });

  if (role === "judge") {
    return buildRelaunchPromptForJudge({ tasks });
  }

  const task = selectAssignedTask({ tasks, slaveId: id });
  if (!task) {
    return null;
  }
  return buildRelaunchPromptForSlave({ promptSettings, task });
};
