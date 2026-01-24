import { isAbsolute, join } from "node:path";
import type { ClankerConfig } from "./config.js";
import type { TaskRecord } from "./state/tasks.js";
import { getRuntimeOverrides } from "./runtime/overrides.js";

export interface PromptSettings {
  mode: "inline" | "file";
  planPromptPath: string;
  planPromptAbsolutePath: string;
}

const resolvePromptPath = ({
  repoRoot,
  promptFile,
}: {
  repoRoot: string;
  promptFile: string;
}): { displayPath: string; absolutePath: string } => {
  if (isAbsolute(promptFile)) {
    return { displayPath: promptFile, absolutePath: promptFile };
  }
  return { displayPath: promptFile, absolutePath: join(repoRoot, promptFile) };
};

export const getPromptSettings = ({
  repoRoot,
  config,
}: {
  repoRoot: string;
  config: ClankerConfig;
}): PromptSettings => {
  const overrides = getRuntimeOverrides();
  const promptFile = overrides.promptFile ?? config.promptFile;
  if (promptFile && promptFile.trim().length > 0) {
    const resolved = resolvePromptPath({ repoRoot, promptFile });
    return {
      mode: "file",
      planPromptPath: resolved.displayPath,
      planPromptAbsolutePath: resolved.absolutePath,
    };
  }
  const fallback = ".clanker/plan-prompt.txt";
  const resolved = resolvePromptPath({ repoRoot, promptFile: fallback });
  return {
    mode: "inline",
    planPromptPath: resolved.displayPath,
    planPromptAbsolutePath: resolved.absolutePath,
  };
};

export const buildPlanFileDispatch = ({ promptPath }: { promptPath: string }): string =>
  `Open ${promptPath} and follow it exactly. Create task packets in .clanker/tasks now.`;

export const buildTaskFileDispatch = ({ taskId }: { taskId: string }): string =>
  `Open .clanker/tasks/${taskId}.json and execute it. Follow the instructions exactly.`;

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

export const buildRelaunchPromptForPlanner = ({
  promptSettings,
}: {
  promptSettings: PromptSettings;
}): RelaunchPrompt => {
  return {
    kind: "plan",
    text: buildPlanFileDispatch({ promptPath: promptSettings.planPromptPath }),
  };
};

export const buildRelaunchPromptForJudge = ({
  tasks,
}: {
  tasks: TaskRecord[];
}): RelaunchPrompt | null => {
  const prompt = buildJudgeRelaunchPrompt({ tasks });
  if (!prompt) {
    return null;
  }
  return { kind: "judge", text: prompt };
};

export const buildRelaunchPromptForSlave = ({
  promptSettings,
  task,
}: {
  promptSettings: PromptSettings;
  task: TaskRecord;
}): RelaunchPrompt => {
  const text =
    promptSettings.mode === "file" || !task.prompt
      ? buildTaskFileDispatch({ taskId: task.id })
      : task.prompt;
  return { kind: "task", text, taskId: task.id };
};
