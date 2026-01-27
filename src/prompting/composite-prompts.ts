import type { PromptSettings } from "../prompting.js";
import type { TaskRecord } from "../state/tasks.js";
import {
  buildBasePrompt,
  buildJudgeTaskDispatch,
  buildTaskFileDispatch,
  ClankerRole,
  mergePromptSections,
} from "./role-prompts.js";

export interface CompositePromptPaths {
  tasksDir: string;
  historyDir: string;
}

export const buildCompositePrompt = ({
  role,
  body,
  paths,
}: {
  role: ClankerRole;
  body: string;
  paths: CompositePromptPaths;
}): string =>
  mergePromptSections({
    sections: [
      buildBasePrompt({
        role,
        paths,
      }),
      body,
    ],
  });

export const buildSlavePrompts = ({
  task,
  paths,
  promptSettings,
}: {
  task: TaskRecord;
  paths: CompositePromptPaths;
  promptSettings: PromptSettings;
}): { displayPrompt: string; dispatchPrompt: string } => {
  const taskPrompt = task.prompt ?? "";
  const fileDispatch = buildTaskFileDispatch({ taskId: task.id, tasksDir: paths.tasksDir });
  const displayPrompt = buildCompositePrompt({
    role: ClankerRole.Slave,
    body: taskPrompt,
    paths,
  });
  const dispatchBody = promptSettings.mode === "file" ? fileDispatch : taskPrompt;
  const dispatchPrompt = buildCompositePrompt({
    role: ClankerRole.Slave,
    body: dispatchBody,
    paths,
  });
  return { displayPrompt, dispatchPrompt };
};

export const buildJudgePrompts = ({
  task,
  paths,
}: {
  task: TaskRecord;
  paths: CompositePromptPaths;
}): { displayPrompt: string; dispatchPrompt: string } => {
  const promptBody = buildJudgeTaskDispatch({
    taskId: task.id,
    tasksDir: paths.tasksDir,
    historyDir: paths.historyDir,
    title: task.title,
  });
  const prompt = buildCompositePrompt({
    role: ClankerRole.Judge,
    body: promptBody,
    paths,
  });
  return { displayPrompt: prompt, dispatchPrompt: prompt };
};
