import type { PromptSettings } from "../prompting.js";
import type { TaskRecord } from "../state/tasks.js";
import {
  buildBasePrompt,
  buildJudgeTaskDispatch,
  buildTaskFileDispatch,
  ClankerRole,
  mergePromptSections,
} from "./role-prompts.js";
import type { JudgeCheckoutResult } from "../state/task-commits.js";

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
  const taskLabel = task.title ? `${task.id}: ${task.title}` : task.id;
  const taskContext = [
    `Task id: ${taskLabel}`,
    "Commit requirement: commit before needs_judge; wrapper will attempt it but do not rely on it.",
    "After committing, run the status and handoff commands in the shell (do not only print them).",
    `Status command: clanker task status ${task.id} needs_judge|blocked|failed`,
    `Handoff command: clanker task handoff ${task.id} slave --summary "..." --tests "..." --diffs "..." --risks "..."`,
    `Note command: clanker task note ${task.id} slave "..."`,
  ].join("\n");
  const buildBody = ({ body }: { body: string }): string =>
    [taskContext, body].filter((part) => part.trim().length > 0).join("\n\n");
  const displayPrompt = buildCompositePrompt({
    role: ClankerRole.Slave,
    body: buildBody({ body: taskPrompt }),
    paths,
  });
  const dispatchBody = promptSettings.mode === "file" ? fileDispatch : taskPrompt;
  const dispatchPrompt = buildCompositePrompt({
    role: ClankerRole.Slave,
    body: buildBody({ body: dispatchBody }),
    paths,
  });
  return { displayPrompt, dispatchPrompt };
};

export const buildJudgePrompts = ({
  task,
  paths,
  judgeCheckout,
}: {
  task: TaskRecord;
  paths: CompositePromptPaths;
  judgeCheckout?: JudgeCheckoutResult;
}): { displayPrompt: string; dispatchPrompt: string } => {
  const promptBody = buildJudgeTaskDispatch({
    taskId: task.id,
    tasksDir: paths.tasksDir,
    historyDir: paths.historyDir,
    title: task.title,
  });
  const taskLabel = task.title ? `${task.id}: ${task.title}` : task.id;
  const commitSha = task.slaveCommitSha?.trim();
  const checkoutStatus = judgeCheckout?.status;
  const checkoutLine = (() => {
    if (!checkoutStatus) {
      return null;
    }
    if (checkoutStatus === "checked_out") {
      return `Judge checkout: checked out ${judgeCheckout.commitSha ?? commitSha ?? "commit"}`;
    }
    if (checkoutStatus === "dirty") {
      return "Judge checkout: worktree dirty; clean it before checkout";
    }
    if (checkoutStatus === "missing_commit") {
      return "Judge checkout: missing slave commit; request rework";
    }
    if (checkoutStatus === "commit_missing_locally") {
      return `Judge checkout: commit missing locally (${judgeCheckout.commitSha ?? commitSha ?? "unknown"})`;
    }
    if (checkoutStatus === "missing_worktree") {
      return "Judge checkout: missing judge worktree";
    }
    if (checkoutStatus === "checkout_failed") {
      return "Judge checkout: checkout failed; verify manually";
    }
    return "Judge checkout: skipped";
  })();
  const commitContext = commitSha
    ? [
        `Task id: ${taskLabel}`,
        `Commit to verify: ${commitSha}`,
        `Checkout command: git checkout --detach ${commitSha}`,
        `Status command: clanker task status ${task.id} done|rework|blocked|failed`,
        `Handoff command: clanker task handoff ${task.id} judge --summary "..." --tests "..." --diffs "..." --risks "..."`,
        `Note command: clanker task note ${task.id} judge "..."`,
      ].join("\n")
    : [
        `Task id: ${taskLabel}`,
        "Commit to verify: (missing; request rework)",
        `Status command: clanker task status ${task.id} done|rework|blocked|failed`,
        `Handoff command: clanker task handoff ${task.id} judge --summary "..." --tests "..." --diffs "..." --risks "..."`,
      ].join("\n");
  const contextParts = [commitContext, checkoutLine].filter((part): part is string =>
    Boolean(part && part.trim().length > 0),
  );
  const prompt = buildCompositePrompt({
    role: ClankerRole.Judge,
    body: [...contextParts, promptBody].join("\n\n"),
    paths,
  });
  return { displayPrompt: prompt, dispatchPrompt: prompt };
};
