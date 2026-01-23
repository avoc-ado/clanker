import type { ClankerPaths } from "../paths.js";
import type { TaskRecord } from "../state/tasks.js";
import { loadConfig } from "../config.js";
import { getPromptSettings, buildPlanFileDispatch, buildTaskFileDispatch } from "../prompting.js";
import { listTasks } from "../state/tasks.js";

const SLAVE_ACTIVE_STATUSES = new Set(["running", "rework"]);

export interface RelaunchPrompt {
  text: string;
  kind: "plan" | "task" | "judge";
  taskId?: string;
}

export const selectAssignedTask = ({
  tasks,
  slaveId,
}: {
  tasks: TaskRecord[];
  slaveId: string;
}): TaskRecord | null => {
  const candidates = tasks.filter(
    (task) => task.assignedSlaveId === slaveId && SLAVE_ACTIVE_STATUSES.has(task.status),
  );
  if (candidates.length === 0) {
    return null;
  }
  const rankStatus = (status: TaskRecord["status"]): number => (status === "running" ? 0 : 1);
  return (
    [...candidates].sort((left, right) => {
      const statusDelta = rankStatus(left.status) - rankStatus(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return left.id.localeCompare(right.id);
    })[0] ?? null
  );
};

export const buildJudgeRelaunchPrompt = ({ tasks }: { tasks: TaskRecord[] }): string | null => {
  const pending = tasks.filter((task) => task.status === "needs_judge");
  if (pending.length === 0) {
    return null;
  }
  const list = pending
    .map((task) => (task.title ? `- ${task.id}: ${task.title}` : `- ${task.id}`))
    .join("\n");
  return [
    "You are the judge.",
    "Review tasks marked needs_judge in .clanker/tasks.",
    list ? `Current queue:\n${list}` : null,
    "For each task: open .clanker/tasks/<id>.json, validate changes, then set status to done/rework/blocked/failed via `clanker task status <id> <status>`.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

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
    return {
      kind: "plan",
      text: buildPlanFileDispatch({ promptPath: promptSettings.planPromptPath }),
    };
  }

  const tasks = await listTasks({ tasksDir: paths.tasksDir });

  if (role === "judge") {
    const prompt = buildJudgeRelaunchPrompt({ tasks });
    if (!prompt) {
      return null;
    }
    return { kind: "judge", text: prompt };
  }

  const task = selectAssignedTask({ tasks, slaveId: id });
  if (!task) {
    return null;
  }
  const text =
    promptSettings.mode === "file" || !task.prompt
      ? buildTaskFileDispatch({ taskId: task.id })
      : task.prompt;
  return { kind: "task", text, taskId: task.id };
};
