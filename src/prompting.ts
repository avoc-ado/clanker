import { isAbsolute, join } from "node:path";
import type { ClankerConfig } from "./config.js";
import type { TaskRecord } from "./state/tasks.js";
import { getRuntimeOverrides } from "./runtime/overrides.js";
import {
  buildJudgeRelaunchPrompt,
  buildPlanFileDispatch,
  buildTaskFileDispatch,
} from "./prompting/role-prompts.js";

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

export const buildRelaunchPromptForPlanner = ({
  promptSettings,
  tasksDir,
}: {
  promptSettings: PromptSettings;
  tasksDir: string;
}): RelaunchPrompt => {
  return {
    kind: "plan",
    text: buildPlanFileDispatch({
      promptPath: promptSettings.planPromptAbsolutePath,
      tasksDir,
    }),
  };
};

export const buildRelaunchPromptForJudge = ({
  tasks,
  tasksDir,
}: {
  tasks: TaskRecord[];
  tasksDir: string;
}): RelaunchPrompt | null => {
  const prompt = buildJudgeRelaunchPrompt({ tasks, tasksDir });
  if (!prompt) {
    return null;
  }
  return { kind: "judge", text: prompt };
};

export const buildRelaunchPromptForSlave = ({
  promptSettings,
  task,
  tasksDir,
}: {
  promptSettings: PromptSettings;
  task: TaskRecord;
  tasksDir: string;
}): RelaunchPrompt => {
  const text =
    promptSettings.mode === "file" || !task.prompt
      ? buildTaskFileDispatch({ taskId: task.id, tasksDir })
      : task.prompt;
  return { kind: "task", text, taskId: task.id };
};
